import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import { ProcessingError, toErrorDetails } from './errors.js'
import { inspectFile } from './inspect-file.js'

export class JobQueue extends EventEmitter {
  #repository
  #registry
  #pending = []
  #running = new Map()
  #concurrency
  #closed = false
  #paused = false
  #closePromise

  constructor({ database, registry, concurrency = 2 }) {
    super()
    this.#repository = database
    this.#registry = registry
    this.setConcurrency(concurrency)
  }

  get concurrency() {
    return this.#concurrency
  }

  setConcurrency(concurrency) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new RangeError('Job concurrency must be from 1 to 8.')
    }
    this.#concurrency = concurrency
    this.#pump()
  }

  pause() {
    this.#paused = true
  }

  resume() {
    if (this.#closed) return
    this.#paused = false
    this.#pump()
  }

  async enqueue({
    sourcePath,
    outputFolder,
    options,
    inspection: suppliedInspection = null,
    monitoredFolderId = null,
    ruleId = null,
  }) {
    if (this.#closed) throw new Error('The processing queue is closed.')
    if (
      typeof outputFolder !== 'string' ||
      !outputFolder ||
      !options ||
      typeof options.outputFormat !== 'string'
    ) {
      throw new ProcessingError('INVALID_JOB', 'The processing job configuration is invalid.')
    }
    const inspection = suppliedInspection ?? await inspectFile(sourcePath)
    const processor = this.#registry.forInput(inspection.format)
    const isSupported = processor?.supportsConversion
      ? processor.supportsConversion(inspection.format, options.outputFormat)
      : processor?.supportsOutput(options.outputFormat)
    if (!isSupported) {
      throw new ProcessingError('UNSUPPORTED_OPERATION', 'This image conversion is not supported.')
    }
    if (this.#repository.hasFingerprint(inspection.fingerprint)) {
      return { id: null, duplicate: true }
    }

    const job = {
      id: this.#repository.create({
        sourcePath: inspection.path,
        inspection,
        outputFormat: options.outputFormat,
        monitoredFolderId,
        ruleId,
      }),
      sourcePath: inspection.path,
      inspection,
      outputFolder,
      options: { ...options },
      processor,
    }
    this.#pending.push(job)
    this.#emitUpdate({ id: job.id, status: 'queued', displayName: basename(job.sourcePath) })
    this.#pump()
    return { id: job.id, duplicate: false }
  }

  cancel(jobId) {
    const pendingIndex = this.#pending.findIndex(({ id }) => id === jobId)
    if (pendingIndex !== -1) {
      const [job] = this.#pending.splice(pendingIndex, 1)
      const record = this.#repository.finish(job.id, {
        status: 'cancelled',
        error: { code: 'JOB_CANCELLED', message: 'The job was cancelled.' },
      })
      this.#emitUpdate({ id: job.id, status: record.status, displayName: basename(job.sourcePath) })
      return true
    }
    const active = this.#running.get(jobId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  close() {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    for (const job of this.#pending.splice(0)) {
      const record = this.#repository.finish(job.id, {
        status: 'cancelled',
        error: {
          code: 'APP_SHUTDOWN',
          message: 'The application closed before this job started.',
        },
      })
      this.#emitUpdate({ id: job.id, status: record.status, displayName: basename(job.sourcePath) })
    }
    const activeJobs = [...this.#running.values()]
    for (const job of activeJobs) job.controller.abort()
    this.#closePromise = Promise.all(activeJobs.map(({ done }) => done))
    return this.#closePromise
  }

  #pump() {
    while (
      !this.#closed &&
      !this.#paused &&
      this.#running.size < this.#concurrency &&
      this.#pending.length > 0
    ) {
      const job = this.#pending.shift()
      const active = {
        controller: new AbortController(),
        displayName: basename(job.sourcePath),
      }
      this.#running.set(job.id, active)
      active.done = this.#execute(job, active)
        .catch((error) => {
          console.error(`Job ${job.id} could not be finalized:`, error)
        })
        .finally(() => {
          this.#running.delete(job.id)
          this.#pump()
        })
    }
  }

  async #execute(job, active) {
    this.#repository.markProcessing(job.id)
    this.#emitUpdate({ id: job.id, status: 'processing', displayName: active.displayName })
    try {
      const result = await job.processor.process({
        sourcePath: job.sourcePath,
        outputFolder: job.outputFolder,
        options: job.options,
        inspection: job.inspection,
      }, { signal: active.controller.signal })
      const record = this.#repository.finish(job.id, { status: 'completed', result })
      this.#emitUpdate({ id: job.id, status: record.status, result, displayName: active.displayName })
    } catch (error) {
      const details = toErrorDetails(error)
      const status = details.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed'
      const record = this.#repository.finish(job.id, { status, error: details })
      if (status === 'failed') console.error(`Job ${job.id} failed:`, details)
      this.#emitUpdate({ id: job.id, status: record.status, error: details, displayName: active.displayName })
    }
  }

  #emitUpdate(update) {
    this.emit('job-updated', update)
  }
}
