import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFile } from '../src/main/processing/inspect-file.js'
import { processAudioFile } from '../src/main/processing/audio-processor.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage6-audio-'))
  temporaryDirectories.push(directory)
  return directory
}

function createWave(path, { sampleRate = 44100, seconds = 1, channels = 2 } = {}) {
  const frameCount = sampleRate * seconds
  const dataLength = frameCount * channels * 2
  const wave = Buffer.alloc(44 + dataLength)
  wave.write('RIFF', 0, 'ascii')
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write('WAVEfmt ', 8, 'ascii')
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(channels, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * channels * 2, 28)
  wave.writeUInt16LE(channels * 2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write('data', 36, 'ascii')
  wave.writeUInt32LE(dataLength, 40)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 12000)
    for (let channel = 0; channel < channels; channel += 1) {
      wave.writeInt16LE(sample, 44 + (frame * channels + channel) * 2)
    }
  }
  writeFileSync(path, wave)
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 6 audio processor', () => {
  it('downsamples real stereo PCM WAV to mono while preserving the original', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'tone.wav')
    createWave(inputPath)
    const original = readFileSync(inputPath)
    const originalHash = createHash('sha256').update(original).digest('hex')
    const inspection = await inspectFile(inputPath)

    const result = await processAudioFile({
      inputPath,
      outputFolder: join(root, 'output'),
      expectedInspection: inspection,
    })
    const output = readFileSync(result.outputPath)

    expect(inspection.format).toBe('wav')
    expect(result.status).toBe('completed')
    expect(result.sampleRate).toBe(22050)
    expect(result.channels).toBe(1)
    expect(output.toString('ascii', 0, 4)).toBe('RIFF')
    expect(output.toString('ascii', 8, 12)).toBe('WAVE')
    expect(output.readUInt32LE(24)).toBe(22050)
    expect(output.readUInt16LE(22)).toBe(1)
    expect(output.length).toBeLessThan(original.length)
    expect(output.readInt16LE(44)).not.toBe(0)
    expect(readFileSync(inputPath)).toEqual(original)
    expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(originalHash)
  })

  it('rejects damaged and unsupported audio without partial output, then recovers', async () => {
    const root = createWorkspace()
    const outputFolder = join(root, 'output')
    const damagedPath = join(root, 'damaged.wav')
    const unsupportedPath = join(root, 'notes.txt')
    const damagedWave = Buffer.alloc(44)
    damagedWave.write('RIFF', 0, 'ascii')
    damagedWave.writeUInt32LE(100, 4)
    damagedWave.write('WAVEfmt ', 8, 'ascii')
    writeFileSync(damagedPath, damagedWave)
    writeFileSync(unsupportedPath, 'not a supported processor input')

    await expect(processAudioFile({ inputPath: damagedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'INVALID_AUDIO' })
    await expect(processAudioFile({ inputPath: unsupportedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(readdirSync(outputFolder)).toEqual([])

    const validPath = join(root, 'valid.wav')
    createWave(validPath)
    const result = await processAudioFile({ inputPath: validPath, outputFolder })
    expect(result.status).toBe('completed')
  })

  it('registers WAV support only through the verified processor', () => {
    const registry = new ProcessorRegistry()
    expect(registry.forInput('wav')).toMatchObject({
      id: 'audio',
      inputFormats: ['wav'],
      outputFormats: ['wav'],
    })
  })
})
