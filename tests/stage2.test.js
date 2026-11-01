import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { fileTypeFromFile } from 'file-type'
import { processImageFile } from '../src/main/processing/image-processor.js'
import { inspectImage } from '../src/main/processing/inspect-image.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage2-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createImage(directory, filename, format) {
  const path = join(directory, filename)
  const image = sharp({
    create: {
      width: 40,
      height: 20,
      channels: 4,
      background: { r: 35, g: 145, b: 125, alpha: 0.8 },
    },
  })
  await image[format]().toFile(path)
  return path
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 2 image processor', () => {
  it('converts real PNG to WebP and leaves the original unchanged', async () => {
    const root = createWorkspace()
    const inputPath = await createImage(root, 'sample.png', 'png')
    const originalHash = createHash('sha256').update(readFileSync(inputPath)).digest('hex')

    const result = await processImageFile({
      inputPath,
      outputFolder: join(root, 'output'),
      outputFormat: 'webp',
      quality: 80,
    })

    expect(result.status).toBe('completed')
    expect(result.inputFormat).toBe('png')
    expect(result.outputFormat).toBe('webp')
    expect((await fileTypeFromFile(result.outputPath)).mime).toBe('image/webp')
    expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(originalHash)
    expect(result.outputPath).toBe(join(realpathSync.native(root), 'output', 'sample.webp'))
  })

  it('converts JPEG to AVIF using the installed AV1 codec', async () => {
    const root = createWorkspace()
    const inputPath = await createImage(root, 'photo.jpg', 'jpeg')
    const result = await processImageFile({
      inputPath,
      outputFolder: join(root, 'output'),
      outputFormat: 'avif',
      quality: 60,
    })

    expect(result.inputFormat).toBe('jpeg')
    expect((await fileTypeFromFile(result.outputPath)).mime).toBe('image/avif')
  })

  it('converts TIFF to JPEG', async () => {
    const root = createWorkspace()
    const inputPath = await createImage(root, 'scan.tif', 'tiff')
    const result = await processImageFile({
      inputPath,
      outputFolder: join(root, 'output'),
      outputFormat: 'jpeg',
    })

    expect(result.inputFormat).toBe('tiff')
    expect((await fileTypeFromFile(result.outputPath)).mime).toBe('image/jpeg')
  })

  it('detects the actual signature when the extension lies', async () => {
    const root = createWorkspace()
    const inputPath = await createImage(root, 'misleading.png', 'jpeg')
    const inspection = await inspectImage(inputPath)
    const result = await processImageFile({
      inputPath,
      outputFolder: join(root, 'output'),
      outputFormat: 'webp',
    })

    expect(inspection.format).toBe('jpeg')
    expect(result.inputFormat).toBe('jpeg')
    expect(result.outputPath).toBe(join(realpathSync.native(root), 'output', 'misleading.webp'))
  })

  it('rejects corrupted input and unsupported operations without leaving partial output', async () => {
    const root = createWorkspace()
    const corrupted = join(root, 'broken.png')
    writeFileSync(corrupted, Buffer.from('not an image'))

    await expect(processImageFile({
      inputPath: corrupted,
      outputFolder: join(root, 'output'),
      outputFormat: 'webp',
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' })

    const source = await createImage(root, 'normal.png', 'png')
    await expect(processImageFile({
      inputPath: source,
      outputFolder: join(root, 'output'),
      outputFormat: 'pdf',
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_FORMAT' })
  })

  it('preserves aspect ratio while resizing and never overwrites an existing file', async () => {
    const root = createWorkspace()
    const inputPath = await createImage(root, 'duplicate.png', 'png')
    const first = await processImageFile({
      inputPath,
      outputFolder: root,
      outputFormat: 'png',
      resize: { width: 10 },
    })
    const second = await processImageFile({
      inputPath,
      outputFolder: root,
      outputFormat: 'png',
    })
    const output = await sharp(first.outputPath).metadata()

    expect(output.width).toBe(10)
    expect(output.height).toBe(5)
    expect(second.outputPath).toBe(join(realpathSync.native(root), 'duplicate-2.png'))
    expect(readFileSync(inputPath).length).toBeGreaterThan(0)
  })

  it('keeps the main event loop responsive while a large image is processed', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'large.png')
    await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 3,
        background: '#326f91',
      },
    }).png().toFile(inputPath)

    let timerFired = false
    const timer = setTimeout(() => { timerFired = true }, 0)
    const result = await processImageFile({
      inputPath,
      outputFolder: join(root, 'output'),
      outputFormat: 'webp',
      resize: { width: 1200, height: 1200 },
    })
    clearTimeout(timer)

    expect(timerFired).toBe(true)
    expect(result.width).toBe(1200)
  })

  it('registers only real processor capabilities', () => {
    const registry = new ProcessorRegistry()
    expect(registry.forInput('png').supportsOutput('avif')).toBe(true)
    expect(registry.forInput('rar')).toBeNull()
    expect(registry.capabilities()).toEqual(expect.arrayContaining([
      expect.objectContaining({
      id: 'image',
      inputFormats: ['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp'],
      outputFormats: ['png', 'jpeg', 'webp', 'avif', 'tiff'],
      }),
      expect.objectContaining({
        id: 'zip',
        inputFormats: ['zip'],
        outputFormats: ['zip'],
      }),
      expect.objectContaining({
        id: 'pdf',
        inputFormats: ['pdf'],
        outputFormats: ['pdf'],
      }),
      expect.objectContaining({
        id: 'audio',
        inputFormats: ['wav'],
        outputFormats: ['wav'],
      }),
      expect.objectContaining({
        id: 'video',
        inputFormats: ['mp4'],
        outputFormats: ['mp4'],
      }),
      expect.objectContaining({
        id: 'document',
        inputFormats: ['docx', 'xlsx', 'pptx'],
        outputFormats: ['docx', 'xlsx', 'pptx'],
      }),
    ]))
  })
})
