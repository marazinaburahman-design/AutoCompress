import { Worker } from 'node:worker_threads'
import { ProcessingError } from './errors.js'

export function runImageWorker(workerData, { signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(new ProcessingError('JOB_CANCELLED', 'The job was cancelled.'))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./image-worker.js', import.meta.url), { workerData })
    let settled = false
    let message = null
    let hasMessage = false
    let exitCode = null
    let aborting = false
    let exitTimeout = null

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
      if (exitTimeout) clearTimeout(exitTimeout)
      worker.removeAllListeners()
    }

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const handleAbort = () => {
      aborting = true
      worker.terminate().then(
        () => finish(reject, new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')),
        (error) => finish(reject, error),
      )
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
    worker.once('message', (workerMessage) => {
      message = workerMessage
      hasMessage = true
      finishAfterExit()
    })
    worker.once('error', (error) => {
      finish(reject, new ProcessingError('WORKER_FAILED', 'The image processor stopped unexpectedly.', { cause: error }))
    })
    worker.once('exit', (code) => {
      exitCode = code
      if (aborting || settled) return
      if (code !== 0) {
        finish(
          reject,
          new ProcessingError('WORKER_EXITED', `The image processor exited unexpectedly (${code}).`),
        )
      } else if (hasMessage) {
        finishAfterExit()
      } else {
        exitTimeout = setTimeout(() => {
          if (!hasMessage) {
            finish(
              reject,
              new ProcessingError('WORKER_NO_RESULT', 'The image processor exited without returning a result.'),
            )
          } else {
            finishAfterExit()
          }
        }, 250)
      }
    })

    function finishAfterExit() {
      if (settled || !hasMessage || exitCode === null) return
      if (!message.ok) {
        finish(reject, new ProcessingError(message.error.code, message.error.message))
      } else if (exitCode === 0) {
        finish(resolve, message.result)
      } else {
        finish(reject, new ProcessingError('WORKER_EXITED', `The image processor exited unexpectedly (${exitCode}).`))
      }
    }
  })
}
