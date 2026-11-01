import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'

const maxInputBytes = 256 * 1024 * 1024
const targetSampleRate = 22050

try {
  const inspection = await inspectFile(workerData.inputPath)
  if (inspection.format !== 'wav') {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'Only WAV audio is supported by this processor.')
  }
  if (inspection.fingerprint !== workerData.expectedFingerprint) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed after it was inspected.')
  }
  if (inspection.size > maxInputBytes) {
    throw new ProcessingError('AUDIO_LIMIT_EXCEEDED', 'The WAV file exceeds the safe input size limit.')
  }

  const input = await readFile(workerData.inputPath)
  if (createHash('sha256').update(input).digest('hex') !== inspection.fingerprint) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being read.')
  }
  const audio = parsePcm16Wave(input)
  const outputSampleRate = Math.min(audio.sampleRate, targetSampleRate)
  const frameCount = Math.ceil(audio.frameCount * outputSampleRate / audio.sampleRate)
  const output = Buffer.allocUnsafe(44 + frameCount * 2)
  writeWaveHeader(output, outputSampleRate, frameCount)
  resampleToMono(audio, output, frameCount, outputSampleRate)

  const finalDetails = await stat(workerData.inputPath)
  if (
    finalDetails.size !== inspection.size ||
    finalDetails.mtimeMs !== inspection.modifiedAtMs
  ) {
    throw new ProcessingError('FILE_CHANGED', 'The file changed while it was being processed.')
  }
  await writeFile(workerData.temporaryPath, output, { flag: 'wx' })
  parentPort.postMessage({
    ok: true,
    result: { frameCount, sampleRate: outputSampleRate, channels: 1, outputSize: output.length },
  })
} catch (error) {
  const code = error instanceof ProcessingError ? error.code : 'INVALID_AUDIO'
  parentPort.postMessage({
    ok: false,
    error: {
      code,
      message: code === 'INVALID_AUDIO'
        ? 'The WAV file is damaged or uses an unsupported audio encoding.'
        : error.message,
    },
  })
}

function parsePcm16Wave(bytes) {
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new ProcessingError('INVALID_AUDIO', 'The WAV file has an invalid RIFF/WAVE header.')
  }
  const riffEnd = bytes.readUInt32LE(4) + 8
  if (riffEnd > bytes.length || riffEnd < 44) {
    throw new ProcessingError('INVALID_AUDIO', 'The WAV file contains an invalid RIFF size.')
  }

  let format = null
  let sampleData = null
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const chunkName = bytes.toString('ascii', offset, offset + 4)
    const chunkSize = bytes.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > riffEnd) throw new ProcessingError('INVALID_AUDIO', 'The WAV file contains a truncated chunk.')
    if (chunkName === 'fmt ') {
      if (chunkSize < 16) throw new ProcessingError('INVALID_AUDIO', 'The WAV format chunk is invalid.')
      format = {
        encoding: bytes.readUInt16LE(chunkStart),
        channels: bytes.readUInt16LE(chunkStart + 2),
        sampleRate: bytes.readUInt32LE(chunkStart + 4),
        byteRate: bytes.readUInt32LE(chunkStart + 8),
        blockAlign: bytes.readUInt16LE(chunkStart + 12),
        bitsPerSample: bytes.readUInt16LE(chunkStart + 14),
      }
    } else if (chunkName === 'data') {
      sampleData = { start: chunkStart, length: chunkSize }
    }
    offset = chunkEnd + (chunkSize & 1)
  }

  if (
    !format ||
    !sampleData ||
    format.encoding !== 1 ||
    ![1, 2].includes(format.channels) ||
    format.sampleRate < 8000 ||
    format.sampleRate > 192000 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== format.channels * 2 ||
    format.byteRate !== format.sampleRate * format.blockAlign ||
    sampleData.length === 0 ||
    sampleData.length % format.blockAlign !== 0
  ) {
    throw new ProcessingError('INVALID_AUDIO', 'The WAV file must contain mono or stereo 16-bit PCM audio.')
  }
  return {
    data: bytes,
    channels: format.channels,
    sampleRate: format.sampleRate,
    frameCount: sampleData.length / format.blockAlign,
    start: sampleData.start,
  }
}

function resampleToMono(audio, output, outputFrameCount, outputSampleRate) {
  const ratio = audio.sampleRate / outputSampleRate
  for (let outputIndex = 0; outputIndex < outputFrameCount; outputIndex += 1) {
    const firstInput = Math.floor(outputIndex * ratio)
    const lastInput = Math.min(audio.frameCount, Math.ceil((outputIndex + 1) * ratio))
    let sum = 0
    let sampleCount = 0
    for (let inputIndex = firstInput; inputIndex < lastInput; inputIndex += 1) {
      const sampleOffset = audio.start + inputIndex * audio.channels * 2
      let sample = 0
      for (let channel = 0; channel < audio.channels; channel += 1) {
        sample += audio.data.readInt16LE(sampleOffset + channel * 2)
      }
      sum += sample / audio.channels
      sampleCount += 1
    }
    output.writeInt16LE(
      sampleCount === 0 ? 0 : Math.max(-32768, Math.min(32767, Math.round(sum / sampleCount))),
      44 + outputIndex * 2,
    )
  }
}

function writeWaveHeader(output, sampleRate, frameCount) {
  const dataLength = frameCount * 2
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(36 + dataLength, 4)
  output.write('WAVE', 8, 'ascii')
  output.write('fmt ', 12, 'ascii')
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(sampleRate * 2, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36, 'ascii')
  output.writeUInt32LE(dataLength, 40)
}
