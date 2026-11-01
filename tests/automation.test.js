import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createFolderRepository, createRuleRepository } from '../src/main/automation/repositories.js'
import { WatcherService } from '../src/main/automation/watcher-service.js'
import { validateRule } from '../src/main/automation/validation.js'
import { openDatabase } from '../src/main/db/database.js'
import { createJobRepository } from '../src/main/processing/job-repository.js'
import { JobQueue } from '../src/main/processing/job-queue.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage3-'))
  temporaryDirectories.push(directory)
  return directory
}

function waitForHistoryCount(database, count, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const interval = setInterval(() => {
      try {
        const total = database.prepare('SELECT COUNT(*) AS count FROM processing_history').get().count
        if (total >= count) {
          clearInterval(interval)
          resolve(total)
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(interval)
          reject(new Error(`Timed out waiting for ${count} history records; found ${total}.`))
        }
      } catch (error) {
        clearInterval(interval)
        reject(error)
      }
    }, 40)
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function makeRule(repository, outputFormat = 'webp') {
  return repository.save(validateRule({
    name: 'PNG to WebP',
    enabled: true,
    priority: 10,
    match: { inputFormat: 'png' },
    action: { outputFormat, quality: 80 },
  }))
}

async function createPng(path, color) {
  const buffer = await sharp({
    create: { width: 48, height: 32, channels: 3, background: color },
  }).png().toBuffer()
  writeFileSync(path, buffer)
  return buffer
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 3 folder automation', () => {
  it('processes 50 unique copied PNGs once, preserves originals, and excludes its output folder', async () => {
    const root = createWorkspace()
    const inbox = join(root, 'inbox')
    mkdirSync(inbox)
    const output = join(inbox, 'output')
    const database = openDatabase(join(root, 'app.sqlite'))
    const folders = createFolderRepository(database)
    const rules = createRuleRepository(database)
    const jobs = createJobRepository(database)
    const queue = new JobQueue({
      database: jobs,
      registry: new ProcessorRegistry(),
      concurrency: 3,
    })
    const folder = await folders.add(inbox)
    makeRule(rules)
    rules.save(validateRule({
      name: 'WebP to PNG',
      enabled: true,
      priority: 5,
      match: { inputFormat: 'webp' },
      action: { outputFormat: 'png', quality: 80 },
    }))
    const watcher = new WatcherService({
      folderRepository: folders,
      ruleRepository: rules,
      jobQueue: queue,
      getOutputFolder: () => output,
      concurrency: 3,
    })

    try {
      await watcher.start()
      const inputs = []
      for (let index = 0; index < 50; index += 1) {
        const input = join(inbox, `image-${index}.png`)
        const color = { r: index * 3, g: 100 + index, b: 200 - index }
        inputs.push({ path: input, bytes: await createPng(input, color) })
      }

      await waitForHistoryCount(database, 50)
      await wait(1200)
      const history = jobs.listHistory(100)
      const outputs = readdirSync(output).filter((name) => name.endsWith('.webp'))
      expect(history).toHaveLength(50)
      expect(history.every(({ status }) => status === 'completed')).toBe(true)
      expect(outputs).toHaveLength(50)
      for (const { path, bytes } of inputs) {
        expect(createHash('sha256').update(readFileSync(path)).digest('hex'))
          .toBe(createHash('sha256').update(bytes).digest('hex'))
      }
      expect(folders.list().find(({ id }) => id === folder.id).enabled).toBe(true)
    } finally {
      await watcher.stop()
      await queue.close()
      database.close()
    }
  }, 60000)

  it('waits for a partial copy, holds work while paused, resumes, and restores monitoring', async () => {
    const root = createWorkspace()
    const inbox = join(root, 'inbox')
    mkdirSync(inbox)
    const output = join(root, 'output')
    const database = openDatabase(join(root, 'app.sqlite'))
    const folders = createFolderRepository(database)
    const rules = createRuleRepository(database)
    const jobs = createJobRepository(database)
    const queue = new JobQueue({
      database: jobs,
      registry: new ProcessorRegistry(),
      concurrency: 1,
    })
    const folder = await folders.add(inbox)
    makeRule(rules)
    const makeWatcher = () => new WatcherService({
      folderRepository: folders,
      ruleRepository: rules,
      jobQueue: queue,
      getOutputFolder: () => output,
      concurrency: 1,
    })
    let watcher = makeWatcher()

    try {
      await watcher.start()
      const sourceBytes = await sharp({
        create: { width: 80, height: 40, channels: 3, background: '#7b4ca8' },
      }).png().toBuffer()
      const partialPath = join(inbox, 'partial.png')
      writeFileSync(partialPath, sourceBytes.subarray(0, 40))
      await wait(1200)
      expect(jobs.listHistory()).toHaveLength(0)
      writeFileSync(partialPath, sourceBytes)
      await waitForHistoryCount(database, 1)

      watcher.pause()
      const pausedPath = join(inbox, 'paused.png')
      await createPng(pausedPath, '#159b80')
      await wait(1200)
      expect(jobs.listHistory()).toHaveLength(1)
      watcher.resume()
      await waitForHistoryCount(database, 2)

      await watcher.stop()
      watcher = makeWatcher()
      await watcher.start()
      const restartedPath = join(inbox, 'after-restart.png')
      await createPng(restartedPath, '#d19a22')
      await waitForHistoryCount(database, 3)

      expect(jobs.listHistory()).toHaveLength(3)
      expect(folders.list()).toEqual([expect.objectContaining({ id: folder.id, enabled: true })])
    } finally {
      await watcher.stop()
      await queue.close()
      database.close()
    }
  }, 30000)

  it('validates rule shapes and persists enable, edit, priority, and delete operations', () => {
    const root = createWorkspace()
    const database = openDatabase(join(root, 'rules.sqlite'))
    const repository = createRuleRepository(database)
    try {
      const rule = makeRule(repository)
      expect(repository.match('png')).toMatchObject({ id: rule.id, action: { outputFormat: 'webp' } })
      const disabled = validateRule({
        id: rule.id,
        enabled: false,
        name: 'Disabled rule',
        priority: rule.priority,
        match: rule.match,
        action: rule.action,
      })
      repository.save(disabled)
      expect(repository.match('png')).toBeNull()
      expect(() => validateRule({ ...rule, action: { outputFormat: 'exe' } })).toThrow(TypeError)
      expect(() => validateRule({ ...rule, match: { inputFormat: 'png', extension: '.png' } })).toThrow(TypeError)
      repository.remove(rule.id)
      expect(repository.list()).toHaveLength(0)
    } finally {
      database.close()
    }
  })
})
