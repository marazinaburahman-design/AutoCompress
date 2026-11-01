import { lstat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessingError } from '../processing/errors.js'

export async function waitForStableFile(path, { intervalMs = 500, timeoutMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let previousState = ''
  let stableSamples = 0
  while (Date.now() < deadline) {
    let details
    try {
      details = await lstat(path)
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw new ProcessingError('FILE_ACCESS_FAILED', 'The incoming file could not be accessed.', { cause: error })
    }
    if (details.isSymbolicLink() || !details.isFile()) return false
    const state = `${details.size}:${details.mtimeMs}`
    stableSamples = state === previousState && details.size > 0 ? stableSamples + 1 : 0
    if (stableSamples >= 2) return true
    previousState = state
    await delay(intervalMs)
  }
  throw new ProcessingError('FILE_NOT_STABLE', 'The incoming file did not finish copying in time.')
}
