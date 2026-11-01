import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'
import { fileTypeFromFile } from 'file-type'
import sharp from 'sharp'

const inputFormats = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/tiff', 'tiff'],
  ['image/bmp', 'bmp'],
])

async function inspect(inputPath) {
  const [signature, details] = await Promise.all([
    fileTypeFromFile(inputPath),
    stat(inputPath),
  ])
  const format = inputFormats.get(signature?.mime)
  if (!format) {
    throw Object.assign(new Error('File signature is not a supported image format.'), {
      code: 'UNSUPPORTED_IMAGE',
    })
  }
  if (details.size <= 0) {
    throw Object.assign(new Error('The image file is empty.'), { code: 'EMPTY_FILE' })
  }

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(inputPath)) hash.update(chunk)
  const finalDetails = await stat(inputPath)
  if (
    finalDetails.size !== details.size ||
    finalDetails.mtimeMs !== details.mtimeMs
  ) {
    throw Object.assign(new Error('The file changed while it was being inspected.'), {
      code: 'FILE_CHANGED',
    })
  }

  return {
    format,
    mime: signature.mime,
    fingerprint: hash.digest('hex'),
    size: details.size,
    modifiedAt: new Date(details.mtimeMs).toISOString(),
    modifiedAtMs: details.mtimeMs,
  }
}

async function processImage({ inputPath, temporaryPath, outputFormat, quality, resize }) {
  const inspection = await inspect(inputPath)
  if (workerData.expectedFingerprint && inspection.fingerprint !== workerData.expectedFingerprint) {
    throw Object.assign(new Error('The file changed after it was inspected.'), { code: 'FILE_CHANGED' })
  }
  sharp.concurrency(1)
  const image = sharp(inputPath, {
    failOn: 'error',
    limitInputPixels: 100_000_000,
    sequentialRead: true,
  })
  if (resize) {
    image.resize({
      width: resize.width,
      height: resize.height,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  const encoders = {
    png: () => image.png({ quality, compressionLevel: 9, effort: 5 }),
    jpeg: () => image.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }),
    webp: () => image.webp({ quality, effort: 4 }),
    avif: () => image.avif({ quality, effort: 4 }),
    tiff: () => image.tiff({ quality, compression: 'lzw' }),
  }
  const encode = encoders[outputFormat]
  if (!encode) {
    throw Object.assign(new Error('Requested image output format is not supported.'), {
      code: 'UNSUPPORTED_OUTPUT_FORMAT',
    })
  }
  const result = await encode().toFile(temporaryPath)
  const finalDetails = await stat(inputPath)
  if (
    finalDetails.size !== inspection.size ||
    finalDetails.mtimeMs !== inspection.modifiedAtMs
  ) {
    throw Object.assign(new Error('The file changed while it was being processed.'), {
      code: 'FILE_CHANGED',
    })
  }
  return {
    width: result.width,
    height: result.height,
    size: result.size,
    input: inspection,
  }
}

try {
  const result = workerData.action === 'inspect'
    ? await inspect(workerData.inputPath)
    : await processImage(workerData)
  parentPort.postMessage({ ok: true, result })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: ['UNSUPPORTED_IMAGE', 'EMPTY_FILE', 'FILE_CHANGED'].includes(error?.code)
        ? error.code
        : 'INVALID_IMAGE',
      message: ['UNSUPPORTED_IMAGE', 'EMPTY_FILE', 'FILE_CHANGED'].includes(error?.code)
        ? error.message
        : 'The image is damaged or could not be decoded.',
    },
  })
}
