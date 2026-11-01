import { lstat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ProcessingError } from './errors.js'
import { runImageWorker } from './run-image-worker.js'

export async function inspectImage(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) {
    throw new ProcessingError('INVALID_INPUT_PATH', 'The input path is invalid.')
  }

  const absolutePath = resolve(inputPath)
  let details
  try {
    details = await lstat(absolutePath)
  } catch (error) {
    throw new ProcessingError('INPUT_UNAVAILABLE', 'The input file is not accessible.', { cause: error })
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new ProcessingError('UNSAFE_INPUT', 'Only regular, non-symlink files can be processed.')
  }

  const canonicalPath = await realpath(absolutePath)
  const metadata = await runImageWorker({ action: 'inspect', inputPath: canonicalPath })
  return { ...metadata, path: canonicalPath }
}
