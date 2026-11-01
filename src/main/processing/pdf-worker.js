import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'

const maxInputBytes = 128 * 1024 * 1024
const maxOutputBytes = 256 * 1024 * 1024
const maxPages = 1000

try {
  const inspection = await inspectFile(workerData.inputPath)
  if (inspection.format !== 'pdf') {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'Only PDF files are supported by this processor.')
  }
  if (inspection.fingerprint !== workerData.expectedFingerprint) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed after it was inspected.')
  }
  if (inspection.size > maxInputBytes) {
    throw new ProcessingError('PDF_LIMIT_EXCEEDED', 'The PDF exceeds the safe input size limit.')
  }
  const bytes = await readFile(workerData.inputPath)
  if (createHash('sha256').update(bytes).digest('hex') !== inspection.fingerprint) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being read.')
  }
  const document = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  })
  const pageCount = document.getPageCount()
  if (pageCount < 1 || pageCount > maxPages) {
    throw new ProcessingError('PDF_LIMIT_EXCEEDED', 'The PDF page count is outside the supported range.')
  }
  const output = await document.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  })
  if (output.byteLength <= 0 || output.byteLength > maxOutputBytes) {
    throw new ProcessingError('PDF_LIMIT_EXCEEDED', 'The processed PDF exceeds the safe output size limit.')
  }
  const verified = await PDFDocument.load(output, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  })
  if (verified.getPageCount() !== pageCount) {
    throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The processed PDF did not pass validation.')
  }
  const finalDetails = await stat(workerData.inputPath)
  if (
    finalDetails.size !== inspection.size ||
    finalDetails.mtimeMs !== inspection.modifiedAtMs
  ) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being processed.')
  }
  await writeFile(workerData.temporaryPath, output, { flag: 'wx' })
  parentPort.postMessage({ ok: true, result: { pageCount, outputSize: output.byteLength } })
} catch (error) {
  const code = error instanceof ProcessingError ? error.code : 'INVALID_PDF'
  parentPort.postMessage({
    ok: false,
    error: {
      code,
      message: code === 'INVALID_PDF'
        ? 'The PDF is damaged, encrypted, or could not be processed.'
        : error.message,
    },
  })
}
