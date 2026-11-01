import { EventEmitter } from 'node:events'
import { lstat, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { watch } from 'chokidar'
import { waitForStableFile } from './file-stability.js'
import { inspectImage } from '../processing/inspect-image.js'

const temporaryFile = /(?:\.tmp|\.part|\.crdownload|\.download|\.partial)$/i
const stableOptions = { stabilityThreshold: 1000, pollInterval: 100 }

export class WatcherService extends EventEmitter {
  #folders
  #rules
  #queue
  #getOutputFolder
  #watchers = new Map()
  #pendingCandidates = []
  #queuedPaths = new Set()
  #inFlightPaths = new Set()
  #pausedCandidates = new Map()
  #inspectionConcurrency
  #activeInspections = 0
  #idleWaiters = []
  #started = false
  #paused = false

  constructor({ folderRepository, ruleRepository, jobQueue, getOutputFolder, concurrency = 2 }) {
    super()
    this.#folders = folderRepository
    this.#rules = ruleRepository
    this.#queue = jobQueue
    this.#getOutputFolder = getOutputFolder
    this.setConcurrency(concurrency)
  }

  get isRunning() {
    return this.#started && this.#watchers.size > 0
  }

  get isPaused() {
    return this.#paused
  }

  async start() {
    if (this.#started) return
    this.#started = true
    const folders = this.#folders.list().filter(({ enabled }) => enabled)
    for (const folder of folders) {
      try {
        await this.#startFolder(folder)
      } catch (error) {
        this.#report('folder-error', folder.id, error)
      }
    }
    this.#pumpInspection()
    this.#notifyStatus()
  }

  async stop() {
    this.#started = false
    const watchers = [...this.#watchers.values()]
    this.#watchers.clear()
    this.#pendingCandidates = []
    this.#queuedPaths.clear()
    await Promise.all(watchers.map((watcher) => watcher.close()))
    if (this.#activeInspections > 0) {
      await new Promise((resolveIdle) => this.#idleWaiters.push(resolveIdle))
    }
    this.#notifyStatus()
  }

  pause() {
    if (this.#paused) return
    this.#paused = true
    this.#queue.pause()
    this.#notifyStatus()
  }

  resume() {
    if (!this.#paused) return
    this.#paused = false
    this.#queue.resume()
    for (const candidate of this.#pausedCandidates.values()) this.#queueCandidate(candidate)
    this.#pausedCandidates.clear()
    this.#pumpInspection()
    this.#notifyStatus()
  }

  setConcurrency(concurrency) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new RangeError('Monitoring concurrency must be from 1 to 8.')
    }
    this.#inspectionConcurrency = concurrency
    this.#queue.setConcurrency(concurrency)
    this.#pumpInspection()
  }

  async addFolder(path) {
    const folder = await this.#folders.add(path)
    if (this.#started && folder.enabled) await this.#startFolder(folder)
    return folder
  }

  async setFolderEnabled(id, enabled) {
    const folder = this.#folders.setEnabled(id, enabled)
    if (!this.#started) return folder
    if (enabled) {
      await this.#startFolder(folder)
    } else {
      await this.#stopFolder(id)
      this.#discardPendingFolder(id)
    }
    return folder
  }

  async removeFolder(id) {
    await this.#stopFolder(id)
    this.#discardPendingFolder(id)
    this.#folders.remove(id)
  }

  #queueCandidate(candidate) {
    const key = candidate.path.toLowerCase()
    if (this.#queuedPaths.has(key) || this.#inFlightPaths.has(key)) return
    this.#queuedPaths.add(key)
    this.#pendingCandidates.push(candidate)
    this.#pumpInspection()
  }

  #pumpInspection() {
    while (
      this.#started &&
      !this.#paused &&
      this.#activeInspections < this.#inspectionConcurrency &&
      this.#pendingCandidates.length > 0
    ) {
      const candidate = this.#pendingCandidates.shift()
      const key = candidate.path.toLowerCase()
      this.#queuedPaths.delete(key)
      this.#inFlightPaths.add(key)
      this.#activeInspections += 1
      this.#processCandidate(candidate)
        .catch((error) => this.#report('file-error', candidate.folderId, error))
        .finally(() => {
          this.#inFlightPaths.delete(key)
          this.#activeInspections -= 1
          if (this.#activeInspections === 0) {
            for (const resolveIdle of this.#idleWaiters.splice(0)) resolveIdle()
          }
          this.#pumpInspection()
        })
    }
  }

  async #processCandidate(candidate) {
    const stable = await waitForStableFile(candidate.path, stableOptions)
    if (!stable) return
    const fileDetails = await lstat(candidate.path)
    if (fileDetails.isSymbolicLink() || !fileDetails.isFile()) return
    const filePath = await realpath(candidate.path)
    if (!isPathWithin(candidate.root, filePath)) return
    if (isOutputPath(candidate.root, filePath, this.#getOutputFolder())) return

    const inspection = await inspectImage(filePath)
    const rule = this.#rules.match(inspection.format)
    if (!rule) return
    const outputFolder = this.#getOutputFolder()
    if (!outputFolder) {
      this.#report(
        'configuration-error',
        candidate.folderId,
        new Error('Choose an output folder before enabling file automation.'),
      )
      return
    }
    await this.#queue.enqueue({
      sourcePath: inspection.path,
      outputFolder,
      options: rule.action,
      inspection,
      monitoredFolderId: candidate.folderId,
      ruleId: rule.id,
    })
  }

  async #startFolder(folder) {
    if (this.#watchers.has(folder.id)) return
    const root = await realpath(folder.path)
    if (isOutputPath(root, root, this.#getOutputFolder())) {
      throw new Error('A folder cannot be monitored when it is also the output folder.')
    }
    const watcher = watch(root, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: stableOptions,
      ignored: (path, details) => shouldIgnorePath(path, details, root, this.#getOutputFolder()),
    })
    this.#watchers.set(folder.id, watcher)
    watcher.on('add', (path) => {
      const candidate = { path: resolve(path), root, folderId: folder.id }
      if (this.#paused) {
        this.#pausedCandidates.set(candidate.path.toLowerCase(), candidate)
      } else {
        this.#queueCandidate(candidate)
      }
    })
    watcher.on('error', (error) => this.#report('watcher-error', folder.id, error))
    try {
      await waitUntilReady(watcher)
    } catch (error) {
      this.#watchers.delete(folder.id)
      await watcher.close()
      throw error
    }
  }

  async #stopFolder(id) {
    const watcher = this.#watchers.get(id)
    if (!watcher) return
    this.#watchers.delete(id)
    await watcher.close()
    this.#notifyStatus()
  }

  #discardPendingFolder(id) {
    this.#pendingCandidates = this.#pendingCandidates.filter((candidate) => {
      if (candidate.folderId !== id) return true
      this.#queuedPaths.delete(candidate.path.toLowerCase())
      return false
    })
    for (const [key, candidate] of this.#pausedCandidates) {
      if (candidate.folderId === id) this.#pausedCandidates.delete(key)
    }
  }

  #report(type, folderId, error) {
    const code = typeof error?.code === 'string' ? error.code : 'MONITORING_ERROR'
    const message = error instanceof Error ? error.message : 'Monitoring failed.'
    console.error(`AutoCompress ${type} (${code}):`, message)
    this.emit(type, { folderId, code, message })
  }

  #notifyStatus() {
    this.emit('status-changed', {
      running: this.isRunning,
      paused: this.#paused,
      watchedFolderCount: this.#watchers.size,
    })
  }
}

function shouldIgnorePath(path, details, root, outputFolder) {
  if (details?.isSymbolicLink?.()) return true
  const name = basename(path)
  if (name.startsWith('~$') || name === '.DS_Store' || temporaryFile.test(name)) return true
  return isOutputPath(root, resolve(path), outputFolder)
}

function isOutputPath(root, candidate, outputFolder) {
  if (typeof outputFolder !== 'string' || outputFolder.length === 0) return false
  const output = resolve(outputFolder)
  return isPathWithin(root, output) && isPathWithin(output, candidate)
}

function isPathWithin(parent, candidate) {
  const canonicalParent = canonicalPathForComparison(parent)
  const canonicalCandidate = canonicalPathForComparison(candidate)
  const relativePath = relative(canonicalParent, canonicalCandidate)
  return relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
}

function canonicalPathForComparison(path) {
  let existingPath = resolve(path)
  const missingSegments = []
  while (true) {
    try {
      return resolve(realpathSync.native(existingPath), ...missingSegments)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      const parent = dirname(existingPath)
      if (parent === existingPath) throw error
      missingSegments.unshift(basename(existingPath))
      existingPath = parent
    }
  }
}

function waitUntilReady(watcher) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      watcher.removeListener('ready', onReady)
      reject(new Error('Folder watcher did not become ready in time.'))
    }, 15000)
    const onReady = () => {
      clearTimeout(timeout)
      resolveReady()
    }
    watcher.once('ready', onReady)
  })
}
