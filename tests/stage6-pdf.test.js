import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFile } from '../src/main/processing/inspect-file.js'
import { processPdfFile } from '../src/main/processing/pdf-processor.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage6-pdf-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createPdf(path) {
  const document = await PDFDocument.create()
  document.setTitle('Processing test document')
  const page = document.addPage([612, 792])
  page.drawText('Real PDF content preserved during processing.')
  document.addPage([612, 792])
  await writeFile(path, await document.save())
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 6 PDF processor', () => {
  it('reserializes a real multi-page PDF and preserves its content and source', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'sample.pdf')
    await createPdf(inputPath)
    const original = readFileSync(inputPath)
    const originalHash = createHash('sha256').update(original).digest('hex')
    const inspection = await inspectFile(inputPath)

    const result = await processPdfFile({
      inputPath,
      outputFolder: join(root, 'output'),
      expectedInspection: inspection,
    })
    const processed = await PDFDocument.load(readFileSync(result.outputPath))

    expect(inspection.format).toBe('pdf')
    expect(result.status).toBe('completed')
    expect(result.pageCount).toBe(2)
    expect(processed.getPageCount()).toBe(2)
    expect(processed.getTitle()).toBe('Processing test document')
    expect(readFileSync(inputPath)).toEqual(original)
    expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(originalHash)
  })

  it('rejects damaged and unsupported inputs without partial outputs, then recovers', async () => {
    const root = createWorkspace()
    const outputFolder = join(root, 'output')
    const damagedPath = join(root, 'damaged.pdf')
    const unsupportedPath = join(root, 'notes.txt')
    writeFileSync(damagedPath, '%PDF-1.7\nthis is not a valid PDF')
    writeFileSync(unsupportedPath, 'not a supported processor input')

    await expect(processPdfFile({ inputPath: damagedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'INVALID_PDF' })
    expect(readdirSync(outputFolder)).toEqual([])
    await expect(processPdfFile({ inputPath: unsupportedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(readdirSync(outputFolder)).toEqual([])

    const validPath = join(root, 'valid.pdf')
    await createPdf(validPath)
    const result = await processPdfFile({ inputPath: validPath, outputFolder })
    expect(result.status).toBe('completed')
    expect(readdirSync(outputFolder)).toEqual(['valid.pdf'])
  })

  it('registers PDF support only through the verified processor', () => {
    const registry = new ProcessorRegistry()
    expect(registry.forInput('pdf')).toMatchObject({
      id: 'pdf',
      inputFormats: ['pdf'],
      outputFormats: ['pdf'],
    })
  })
})
