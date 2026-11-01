import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFile } from '../src/main/processing/inspect-file.js'
import { processVideoFile } from '../src/main/processing/video-processor.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage6-video-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createRealMp4(path) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<canvas id="canvas" width="64" height="64"></canvas>')
    const bytes = await page.evaluate(async () => {
      const canvas = document.querySelector('#canvas')
      const context = canvas.getContext('2d')
      const chunks = []
      const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/mp4' })
      recorder.ondataavailable = ({ data }) => chunks.push(data)
      const stopped = new Promise((resolve) => { recorder.onstop = resolve })
      recorder.start()
      for (let frame = 0; frame < 10; frame += 1) {
        context.fillStyle = `rgb(${frame * 20},40,120)`
        context.fillRect(0, 0, canvas.width, canvas.height)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      recorder.stop()
      await stopped
      return new Uint8Array(await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer())
    })
    await writeFile(path, Buffer.from(bytes))
  } finally {
    await browser.close()
  }
}

function readBoxes(buffer, start, end) {
  const boxes = []
  for (let offset = start; offset < end;) {
    const size = buffer.readUInt32BE(offset)
    if (size < 8 || offset + size > end) throw new Error('Invalid MP4 test fixture.')
    boxes.push({ start: offset, end: offset + size, size, type: buffer.toString('ascii', offset + 4, offset + 8) })
    offset += size
  }
  return boxes
}

function createBox(type, payload) {
  const box = Buffer.alloc(8 + payload.length)
  box.writeUInt32BE(box.length, 0)
  box.write(type, 4, 'ascii')
  payload.copy(box, 8)
  return box
}

function createNonFragmentedMp4(path) {
  const ftyp = createBox('ftyp', Buffer.from('isom\u0000\u0000\u0000\u0000isom', 'binary'))
  const media = Buffer.from('synthetic media payload')
  const mdat = createBox('mdat', media)
  const offset = ftyp.length + 8
  const tablePayload = Buffer.alloc(12)
  tablePayload.writeUInt32BE(1, 4)
  tablePayload.writeUInt32BE(offset, 8)
  const stco = createBox('stco', tablePayload)
  const stbl = createBox('stbl', stco)
  const minf = createBox('minf', stbl)
  const mdia = createBox('mdia', minf)
  const trak = createBox('trak', mdia)
  const moov = createBox('moov', trak)
  const contents = Buffer.concat([ftyp, mdat, moov])
  writeFileSync(path, contents)
  return { media, moovSize: moov.length, originalOffset: offset }
}

function getChunkOffset(path) {
  const bytes = readFileSync(path)
  function findOffset(start, end) {
    for (const box of readBoxes(bytes, start, end)) {
      if (box.type === 'stco') return bytes.readUInt32BE(box.start + 16)
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(box.type)) {
        const found = findOffset(box.start + 8, box.end)
        if (found !== undefined) return found
      }
    }
    return undefined
  }
  return findOffset(0, bytes.length)
}

function getMediaPayload(path) {
  const bytes = readFileSync(path)
  const mediaBox = readBoxes(bytes, 0, bytes.length).find(({ type }) => type === 'mdat')
  return bytes.subarray(mediaBox.start + 8, mediaBox.end)
}

async function canReadVideo(path) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<video id="video"></video>')
    return await page.evaluate(async (source) => {
      const video = document.querySelector('#video')
      video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(source), (char) => char.charCodeAt(0))], {
        type: 'video/mp4',
      }))
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve
        video.onerror = () => reject(new Error('The processed MP4 could not be decoded.'))
      })
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
    }, readFileSync(path).toString('base64'))
  } finally {
    await browser.close()
  }
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 6 video processor', () => {
  it('preserves a real browser-generated MP4 and confirms it remains decodable', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'sample.mp4')
    await createRealMp4(inputPath)
    const original = readFileSync(inputPath)
    const inspection = await inspectFile(inputPath)

    const result = await processVideoFile({
      inputPath,
      outputFolder: join(root, 'output'),
      expectedInspection: inspection,
    })
    const outputBoxes = readBoxes(readFileSync(result.outputPath), 0, result.outputSize)

    expect(inspection.format).toBe('mp4')
    expect(result.status).toBe('completed')
    expect(result.metadataMoved).toBe(false)
    expect(outputBoxes.findIndex(({ type }) => type === 'moov'))
      .toBeLessThan(outputBoxes.findIndex(({ type }) => type === 'mdat'))
    expect(await canReadVideo(result.outputPath)).toMatchObject({ width: 64, height: 64 })
    expect(readFileSync(inputPath)).toEqual(original)
  })

  it('moves non-fragmented MP4 metadata and adjusts real chunk offsets', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'slow.mp4')
    const outputFolder = join(root, 'output')
    const { media, moovSize, originalOffset } = createNonFragmentedMp4(inputPath)

    const result = await processVideoFile({ inputPath, outputFolder })
    const outputBoxes = readBoxes(readFileSync(result.outputPath), 0, result.outputSize)

    expect(result.metadataMoved).toBe(true)
    expect(outputBoxes.map(({ type }) => type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(getMediaPayload(result.outputPath)).toEqual(media)
    expect(getChunkOffset(result.outputPath)).toBe(originalOffset + moovSize)
  })

  it('rejects damaged and unsupported inputs without partial output, then recovers', async () => {
    const root = createWorkspace()
    const outputFolder = join(root, 'output')
    const damagedPath = join(root, 'damaged.mp4')
    const unsupportedPath = join(root, 'notes.txt')
    const damaged = Buffer.alloc(20)
    damaged.writeUInt32BE(12, 0)
    damaged.write('ftyp', 4, 'ascii')
    damaged.write('isom', 8, 'ascii')
    writeFileSync(damagedPath, damaged)
    writeFileSync(unsupportedPath, 'not a supported processor input')

    await expect(processVideoFile({ inputPath: damagedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'INVALID_VIDEO' })
    expect(readdirSync(outputFolder)).toEqual([])
    await expect(processVideoFile({ inputPath: unsupportedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(readdirSync(outputFolder)).toEqual([])

    const validPath = join(root, 'valid.mp4')
    await createRealMp4(validPath)
    const result = await processVideoFile({ inputPath: validPath, outputFolder })
    expect(result.status).toBe('completed')
  })

  it('registers MP4 support only through the verified processor', () => {
    const registry = new ProcessorRegistry()
    expect(registry.forInput('mp4')).toMatchObject({
      id: 'video',
      inputFormats: ['mp4'],
      outputFormats: ['mp4'],
    })
  })
})
