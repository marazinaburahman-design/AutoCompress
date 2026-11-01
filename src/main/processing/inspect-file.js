import { createReadStream } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { ProcessingError } from './errors.js'
import { listZipEntries } from './zip-archive.js'

const mimeFormats = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/tiff', 'tiff'],
  ['image/bmp', 'bmp'],
  ['application/zip', 'zip'],
  ['application/pdf', 'pdf'],
  ['audio/vnd.wave', 'wav'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['video/mp4', 'mp4'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
])

export async function inspectFile(inputPath) {
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
  if (details.size <= 0) throw new ProcessingError('EMPTY_FILE', 'The file is empty.')

  const canonicalPath = await realpath(absolutePath)
  const [signature, initialDetails] = await Promise.all([
    fileTypeFromFile(canonicalPath),
    stat(canonicalPath),
  ])
  let format = mimeFormats.get(signature?.mime)
  if (format === 'zip' || ['docx', 'xlsx', 'pptx'].includes(format)) {
    const entries = await listZipEntries(canonicalPath)
    if (format === 'zip') {
      if (isOfficeDocument(entries, 'word/document.xml')) format = 'docx'
      else if (isOfficeDocument(entries, 'xl/workbook.xml')) format = 'xlsx'
      else if (isOfficeDocument(entries, 'ppt/presentation.xml')) format = 'pptx'
    } else {
      const requiredEntry = {
        docx: 'word/document.xml',
        xlsx: 'xl/workbook.xml',
        pptx: 'ppt/presentation.xml',
      }[format]
      if (!isOfficeDocument(entries, requiredEntry)) {
        throw new ProcessingError('INVALID_DOCUMENT', 'The Office package is missing required content.')
      }
    }
  }
  if (!format) {
    throw new ProcessingError('UNSUPPORTED_FILE', 'The file signature is not supported.')
  }

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(canonicalPath)) hash.update(chunk)
  const finalDetails = await stat(canonicalPath)
  if (
    finalDetails.size !== initialDetails.size ||
    finalDetails.mtimeMs !== initialDetails.mtimeMs
  ) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being inspected.')
  }

  return {
    format,
    mime: signature.mime,
    fingerprint: hash.digest('hex'),
    size: finalDetails.size,
    modifiedAt: new Date(finalDetails.mtimeMs).toISOString(),
    modifiedAtMs: finalDetails.mtimeMs,
    path: canonicalPath,
  }
}

function isOfficeDocument(entries, requiredEntry) {
  return entries.includes('[Content_Types].xml') &&
    entries.includes('_rels/.rels') &&
    entries.includes(requiredEntry)
}
