import { link, lstat, mkdir, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'
import { adjustChunkOffsets, inspectMp4 } from './mp4-container.js'

const maxInputBytes = 2 * 1024 * 1024 * 1024
const maxMoovBytes = 64 * 1024 * 1024
const copyChunkSize = 1024 * 1024

export async function processVideoFile({ inputPath, outputFolder, expectedInspection }, { signal } = {}) {
  const input = expectedInspection ?? await inspectFile(inputPath)
  if (input.format !== 'mp4') {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'Only MP4 video is supported by this processor.')
  }
  if (input.size > maxInputBytes) {
    throw new ProcessingError('VIDEO_LIMIT_EXCEEDED', 'The MP4 exceeds the safe input size limit.')
  }
  if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')

  const outputDirectory = await prepareOutputDirectory(outputFolder, input.path)
  const stagingDirectory = await mkdtemp(join(outputDirectory, '.autocompress-'))
  const temporaryPath = join(stagingDirectory, 'processed.mp4')
  const startedAt = performance.now()
  try {
    const metadataMoved = await moveMetadataForStreaming(input.path, temporaryPath, signal)
    const outputDetails = await stat(temporaryPath)
    const currentInput = await inspectFile(input.path)
    if (currentInput.fingerprint !== input.fingerprint) {
      throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being processed.')
    }
    const outputHandle = await open(temporaryPath, 'r')
    try {
      const verified = await inspectMp4(outputHandle, outputDetails.size)
      if (verified.shouldRelocate) {
        throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The MP4 metadata was not moved to the streaming position.')
      }
    } finally {
      await outputHandle.close()
    }
    if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
    const outputPath = await finalizeWithoutOverwrite(temporaryPath, outputDirectory, input.path)
    return {
      originalPath: input.path,
      outputPath,
      inputFormat: 'mp4',
      outputFormat: 'mp4',
      originalSize: input.size,
      outputSize: outputDetails.size,
      spaceSaved: input.size - outputDetails.size,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: 'completed',
      metadataMoved,
      fingerprint: input.fingerprint,
      sourceModifiedAt: input.modifiedAt,
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

async function moveMetadataForStreaming(inputPath, outputPath, signal) {
  const inputHandle = await open(inputPath, 'r')
  let outputHandle
  try {
    outputHandle = await open(outputPath, 'wx')
    const inputDetails = await inputHandle.stat()
    if (inputDetails.size > maxInputBytes) {
      throw new ProcessingError('VIDEO_LIMIT_EXCEEDED', 'The MP4 exceeds the safe input size limit.')
    }
    const structure = await inspectMp4(inputHandle, inputDetails.size, {
      adjustOffsetsBy: 0,
    })
    if (structure.moov.size > maxMoovBytes) {
      throw new ProcessingError('VIDEO_LIMIT_EXCEEDED', 'The MP4 metadata exceeds the safe processing limit.')
    }
    const adjustment = structure.shouldRelocate ? structure.moov.size : 0
    const moovBuffer = adjustment
      ? await readAndAdjustMoov(inputHandle, structure, adjustment)
      : structure.moovBuffer
    const orderedBoxes = structure.shouldRelocate
      ? [
          ...structure.boxes.slice(0, structure.firstMediaIndex),
          structure.moov,
          ...structure.boxes.slice(structure.firstMediaIndex).filter((box) => box.type !== 'moov'),
        ]
      : structure.boxes

    let outputPosition = 0
    for (const box of orderedBoxes) {
      if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
      if (box.type === 'moov') {
        outputPosition = await writeBuffer(outputHandle, moovBuffer, outputPosition)
      } else {
        outputPosition = await copyRange(
          inputHandle,
          outputHandle,
          box.start,
          box.end,
          outputPosition,
          signal,
        )
      }
    }
    if (outputPosition !== inputDetails.size) {
      throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The MP4 layout could not be preserved.')
    }
  } finally {
    await Promise.all([
      inputHandle.close(),
      outputHandle ? outputHandle.close() : Promise.resolve(),
    ])
  }
  const inputDetails = await stat(inputPath)
  const outputDetails = await stat(outputPath)
  if (inputDetails.size !== outputDetails.size) {
    throw new ProcessingError('OUTPUT_VALIDATION_FAILED', 'The MP4 layout changed the media size.')
  }
  const inputReader = await open(inputPath, 'r')
  try {
    const inputStructure = await inspectMp4(inputReader, inputDetails.size)
    return inputStructure.shouldRelocate
  } finally {
    await inputReader.close()
  }
}

async function readAndAdjustMoov(inputHandle, structure, adjustment) {
  const buffer = Buffer.alloc(structure.moov.size)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const result = await inputHandle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      structure.moov.start + bytesRead,
    )
    if (result.bytesRead === 0) {
      throw new ProcessingError('INVALID_VIDEO', 'The MP4 metadata is truncated.')
    }
    bytesRead += result.bytesRead
  }
  const originalRanges = structure.mediaBoxes.map(({ payloadStart, end }) => ({
    start: payloadStart,
    end,
  }))
  adjustChunkOffsets(buffer, structure.moov.headerSize, buffer.length, adjustment, originalRanges)
  return buffer
}

async function copyRange(inputHandle, outputHandle, start, end, outputPosition, signal) {
  const buffer = Buffer.allocUnsafe(copyChunkSize)
  for (let position = start; position < end;) {
    if (signal?.aborted) throw new ProcessingError('JOB_CANCELLED', 'The job was cancelled.')
    const length = Math.min(buffer.length, end - position)
    const { bytesRead } = await inputHandle.read(buffer, 0, length, position)
    if (bytesRead !== length) {
      throw new ProcessingError('INVALID_VIDEO', 'The MP4 file changed while it was being processed.')
    }
    outputPosition = await writeBuffer(outputHandle, buffer.subarray(0, length), outputPosition)
    position += bytesRead
  }
  return outputPosition
}

async function writeBuffer(handle, buffer, position) {
  let written = 0
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, position + written)
    if (result.bytesWritten === 0) throw new ProcessingError('OUTPUT_WRITE_FAILED', 'The video result could not be written.')
    written += result.bytesWritten
  }
  return position + written
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
    const destination = join(outputFolder, `${name}.mp4`)
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
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) return 'processed-video'
  return safe
}
