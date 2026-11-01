import { link, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { ProcessingError } from './errors.js'
import { inspectImage } from './inspect-image.js'
import { runImageWorker } from './run-image-worker.js'

const outputExtensions = Object.freeze({
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  avif: '.avif',
  tiff: '.tiff',
})
const supportedOutputFormats = new Set(Object.keys(outputExtensions))
const outputMimeTypes = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
})

export async function processImageFile({
  inputPath,
  outputFolder,
  outputFormat,
  quality = 80,
  resize = null,
  expectedInspection = null,
}, { signal } = {}) {
  validateOptions({ outputFormat, quality, resize })
  const input = expectedInspection ?? await inspectImage(inputPath)
  if (signal?.aborted) {
    throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
  }
  if (typeof outputFolder !== 'string' || outputFolder.length === 0 || outputFolder.includes('\0')) {
    throw new ProcessingError('INVALID_OUTPUT_PATH', 'Choose a valid output folder.')
  }

  const requestedOutputFolder = resolve(outputFolder)
  const outputFolderStat = await lstat(requestedOutputFolder).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (outputFolderStat?.isSymbolicLink()) {
    throw new ProcessingError('UNSAFE_OUTPUT_PATH', 'The output folder cannot be a symbolic link.')
  }
  await mkdir(requestedOutputFolder, { recursive: true })
  const canonicalOutputFolder = await realpath(requestedOutputFolder)
  if (input.path.toLowerCase() === canonicalOutputFolder.toLowerCase()) {
    throw new ProcessingError('OUTPUT_IS_INPUT', 'The output folder cannot be the input file.')
  }

  const startedAt = performance.now()
  const stagingDirectory = await mkdtempInOutput(canonicalOutputFolder)
  const temporaryPath = join(stagingDirectory, `processed${outputExtensions[outputFormat]}`)
  try {
    const encoded = await runImageWorker({
      action: 'process',
      inputPath: input.path,
      temporaryPath,
      outputFormat,
      quality,
      resize,
      expectedFingerprint: input.fingerprint,
    }, { signal })
    const [outputSignature, outputDetails] = await Promise.all([
      fileTypeFromFile(temporaryPath),
      stat(temporaryPath),
    ])
    if (outputSignature?.mime !== outputMimeTypes[outputFormat] || outputDetails.size <= 0) {
      throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The processed image did not pass output validation.')
    }
    if (signal?.aborted) {
      throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
    }
    const outputPath = await finalizeWithoutOverwrite(
      temporaryPath,
      canonicalOutputFolder,
      input.path,
      outputExtensions[outputFormat],
    )
    return {
      originalPath: input.path,
      outputPath,
      inputFormat: input.format,
      outputFormat,
      originalSize: input.size,
      outputSize: outputDetails.size,
      spaceSaved: input.size - outputDetails.size,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: 'completed',
      width: encoded.width,
      height: encoded.height,
      fingerprint: input.fingerprint,
      sourceModifiedAt: input.modifiedAt,
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

async function mkdtempInOutput(outputFolder) {
  return mkdtemp(join(outputFolder, '.autocompress-'))
}

async function finalizeWithoutOverwrite(temporaryPath, outputFolder, inputPath, extension) {
  const inputName = basename(inputPath, extname(inputPath))
  const safeName = sanitizeFileName(inputName)
  for (let suffix = 0; suffix <= 10000; suffix += 1) {
    const numberedName = suffix === 0 ? safeName : `${safeName}-${suffix}`
    const destination = join(outputFolder, `${numberedName}${extension}`)
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
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) return 'processed-image'
  return safe
}

function validateOptions({ outputFormat, quality, resize }) {
  if (!supportedOutputFormats.has(outputFormat)) {
    throw new ProcessingError('UNSUPPORTED_OUTPUT_FORMAT', 'Choose a supported image output format.')
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new ProcessingError('INVALID_QUALITY', 'Image quality must be an integer from 1 to 100.')
  }
  if (resize !== null) {
    const isDimension = (value) => Number.isInteger(value) && value >= 1 && value <= 32768
    const dimensions = resize && Object.entries(resize)
    if (
      !dimensions?.length ||
      dimensions.length > 2 ||
      dimensions.some(([key, value]) => !['width', 'height'].includes(key) || !isDimension(value))
    ) {
      throw new ProcessingError('INVALID_RESIZE', 'Image dimensions must be from 1 to 32768 pixels.')
    }
  }
}
