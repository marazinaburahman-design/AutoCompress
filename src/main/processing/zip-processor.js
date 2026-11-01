import { createWriteStream } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'

const maxEntries = 10000
const maxEntrySize = 256 * 1024 * 1024
const maxTotalSize = 1024 * 1024 * 1024

export async function processZipFile({
  inputPath,
  outputFolder,
  expectedInspection,
  allowedFormats = ['zip'],
}, { signal } = {}) {
  const input = expectedInspection ?? await inspectFile(inputPath)
  if (!allowedFormats.includes(input.format)) {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'The archive format is not supported by this processor.')
  }
  if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')

  const outputDirectory = await prepareOutputDirectory(outputFolder, input.path)
  const stagingDirectory = await mkdtemp(join(outputDirectory, '.autocompress-'))
  const temporaryPath = join(stagingDirectory, `processed.${input.format}`)
  const startedAt = performance.now()
  try {
    await rewriteArchive(input.path, temporaryPath, signal)
    const outputDetails = await stat(temporaryPath)
    const currentInput = await inspectFile(input.path)
    if (currentInput.fingerprint !== input.fingerprint) {
      throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being processed.')
    }
    if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
    const outputPath = await finalizeWithoutOverwrite(
      temporaryPath,
      outputDirectory,
      input.path,
      input.format,
    )
    return {
      originalPath: input.path,
      outputPath,
      inputFormat: input.format,
      outputFormat: input.format,
      originalSize: input.size,
      outputSize: outputDetails.size,
      spaceSaved: input.size - outputDetails.size,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: 'completed',
      fingerprint: input.fingerprint,
      sourceModifiedAt: input.modifiedAt,
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

async function rewriteArchive(inputPath, outputPath, signal) {
  const archive = await openArchive(inputPath)
  const writer = new yazl.ZipFile()
  const output = createWriteStream(outputPath, { flags: 'wx' })
  let count = 0
  let totalSize = 0
  let settled = false
  let rejectResult
  const result = new Promise((resolve, reject) => {
    rejectResult = reject
    archive.on('error', (error) => fail(invalidArchive(error)))
    writer.on('error', (error) => fail(invalidArchive(error)))
    output.on('error', (error) => fail(new ProcessingError('OUTPUT_WRITE_FAILED', 'The archive result could not be written.', { cause: error })))
    archive.on('entry', (entry) => {
      try {
        if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
        count += 1
        totalSize += entry.uncompressedSize
        if (count > maxEntries || entry.uncompressedSize > maxEntrySize || totalSize > maxTotalSize) {
          throw new ProcessingError('ARCHIVE_LIMIT_EXCEEDED', 'The archive exceeds safe processing limits.')
        }
        validateEntry(entry)
        if (entry.fileName.endsWith('/')) {
          writer.addEmptyDirectory(entry.fileName, { mtime: entry.getLastModDate() })
        } else {
          writer.addReadStreamLazy(entry.fileName, {
            mtime: entry.getLastModDate(),
            mode: 0o100644,
            compress: true,
            compressionLevel: 9,
            size: entry.uncompressedSize,
          }, (callback) => {
            archive.openReadStream(entry, (error, stream) => {
              if (error) callback(invalidArchive(error))
              else callback(null, stream)
            })
          })
        }
        archive.readEntry()
      } catch (error) {
        fail(error)
      }
    })
    archive.on('end', () => writer.end())
    output.on('finish', () => {
      if (settled) return
      settled = true
      archive.close()
      resolve()
    })
  })

  const onAbort = () => fail(new ProcessingError('JOB_CANCELLED', 'The job was cancelled.'))
  const fail = (error) => {
    if (settled) return
    settled = true
    archive.close()
    output.destroy()
    writer.outputStream.destroy()
    rejectResult(error)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    writer.outputStream.pipe(output)
    archive.readEntry()
    await result
    await finished(output)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!settled) archive.close()
  }
}

function openArchive(inputPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(inputPath, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, archive) => {
      if (error) reject(invalidArchive(error))
      else resolve(archive)
    })
  })
}

function validateEntry(entry) {
  if (
    !entry.fileName ||
    entry.fileName.includes('\0') ||
    entry.fileName.startsWith('/') ||
    /^[a-z]:/i.test(entry.fileName) ||
    entry.fileName.split('/').some((part) => part === '..')
  ) {
    throw new ProcessingError('UNSAFE_ARCHIVE_ENTRY', 'The archive contains an unsafe entry path.')
  }
  if ((entry.generalPurposeBitFlag & 1) !== 0) {
    throw new ProcessingError('ENCRYPTED_ARCHIVE', 'Password-protected ZIP archives are not supported.')
  }
  const unixMode = entry.externalFileAttributes >>> 16
  if ((unixMode & 0o170000) === 0o120000) {
    throw new ProcessingError('UNSAFE_ARCHIVE_ENTRY', 'The archive contains a symbolic link.')
  }
}

function invalidArchive(error) {
  if (error instanceof ProcessingError) return error
  return new ProcessingError('INVALID_ARCHIVE', 'The ZIP archive is damaged or invalid.', { cause: error })
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

async function finalizeWithoutOverwrite(temporaryPath, outputFolder, inputPath, format) {
  const inputName = basename(inputPath, extname(inputPath))
  const safeName = sanitizeFileName(inputName)
  for (let suffix = 0; suffix <= 10000; suffix += 1) {
    const name = suffix === 0 ? safeName : `${safeName}-${suffix}`
    const destination = join(outputFolder, `${name}.${format}`)
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
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) return 'processed-archive'
  return safe
}
