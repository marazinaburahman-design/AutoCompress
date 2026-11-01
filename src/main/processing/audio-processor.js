import { link, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'
import { runAudioWorker } from './run-audio-worker.js'

export async function processAudioFile({ inputPath, outputFolder, expectedInspection }, context = {}) {
  const input = expectedInspection ?? await inspectFile(inputPath)
  if (input.format !== 'wav') {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'Only WAV audio is supported by this processor.')
  }
  if (context.signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')

  const outputDirectory = await prepareOutputDirectory(outputFolder, input.path)
  const stagingDirectory = await mkdtemp(join(outputDirectory, '.autocompress-'))
  const temporaryPath = join(stagingDirectory, 'processed.wav')
  const startedAt = performance.now()
  try {
    const processed = await runAudioWorker({
      inputPath: input.path,
      temporaryPath,
      expectedFingerprint: input.fingerprint,
    }, context)
    const outputDetails = await stat(temporaryPath)
    if (outputDetails.size !== processed.outputSize) {
      throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The processed WAV did not pass validation.')
    }
    if (context.signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
    const outputPath = await finalizeWithoutOverwrite(temporaryPath, outputDirectory, input.path)
    return {
      originalPath: input.path,
      outputPath,
      inputFormat: 'wav',
      outputFormat: 'wav',
      originalSize: input.size,
      outputSize: outputDetails.size,
      spaceSaved: input.size - outputDetails.size,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: 'completed',
      sampleRate: processed.sampleRate,
      channels: processed.channels,
      fingerprint: input.fingerprint,
      sourceModifiedAt: input.modifiedAt,
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

async function prepareOutputDirectory(outputFolder, inputPath) {
  if (typeof outputFolder !== 'string' || !outputFolder || outputFolder.includes('\0')) {
    throw new ProcessingError('INVALID_OUTPUT_PATH', 'Choose a valid output folder.')
  }
  const requested = resolve(outputFolder)
  const details = await lstat(requested).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (details?.isSymbolicLink()) {
    throw new ProcessingError('UNSAFE_OUTPUT_PATH', 'The output folder cannot be a symbolic link.')
  }
  await mkdir(requested, { recursive: true })
  const canonical = await realpath(requested)
  if (inputPath.toLowerCase() === canonical.toLowerCase()) {
    throw new ProcessingError('OUTPUT_IS_INPUT', 'The output folder cannot be the input file.')
  }
  return canonical
}

async function finalizeWithoutOverwrite(temporaryPath, outputFolder, inputPath) {
  const safeName = sanitizeFileName(basename(inputPath, extname(inputPath)))
  for (let suffix = 0; suffix <= 10000; suffix += 1) {
    const name = suffix === 0 ? safeName : `${safeName}-${suffix}`
    const destination = join(outputFolder, `${name}.wav`)
    try {
      await link(temporaryPath, destination)
      return destination
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw new ProcessingError('OUTPUT_FINALIZATION_FAILED', 'The result could not be saved safely.', { cause: error })
    }
  }
  throw new ProcessingError('OUTPUT_NAME_EXHAUSTED', 'No unused output filename is available.')
}

function sanitizeFileName(fileName) {
  const safe = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 170)
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) return 'processed-audio'
  return safe
}
