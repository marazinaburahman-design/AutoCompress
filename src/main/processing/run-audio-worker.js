import { Worker } from 'node:worker_threads'
import { ProcessingError } from './errors.js'

const workerTimeoutMs = 120000

export function runAudioWorker(workerData, { signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(new ProcessingError('JOB_CANCELLED', 'The job was cancelled.'))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audio-worker.js', import.meta.url), { workerData })
    let settled = false
    let resultMessage = null
    const timeout = setTimeout(() => {
      terminate(new ProcessingError('PROCESSOR_TIMEOUT', 'Audio processing exceeded the time limit.'))
    }, workerTimeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      worker.removeAllListeners()
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const terminate = (error) => {
      if (settled) return
      worker.terminate().then(
        () => finish(reject, error),
        (terminationError) => finish(reject, terminationError),
      )
    }
    const handleAbort = () => terminate(new ProcessingError('JOB_CANCELLED', 'The job was cancelled.'))

    signal?.addEventListener('abort', handleAbort, { once: true })
    worker.on('message', (message) => { resultMessage = message })
    worker.once('error', (error) => {
      finish(reject, new ProcessingError('WORKER_FAILED', 'The audio processor stopped unexpectedly.', { cause: error }))
    })
    worker.once('exit', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(reject, new ProcessingError('WORKER_EXITED', `The audio processor exited unexpectedly (${code}).`))
      } else if (!resultMessage) {
        finish(reject, new ProcessingError('WORKER_NO_RESULT', 'The audio processor exited without returning a result.'))
      } else if (!resultMessage.ok) {
        finish(reject, new ProcessingError(resultMessage.error.code, resultMessage.error.message))
      } else {
        finish(resolve, resultMessage.result)
      }
    })
  })
}
