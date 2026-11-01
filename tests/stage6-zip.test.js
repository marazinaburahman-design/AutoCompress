import { createHash } from 'node:crypto'
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFile } from '../src/main/processing/inspect-file.js'
import { processZipFile } from '../src/main/processing/zip-processor.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage6-zip-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createArchive(path, options = {}) {
  const archive = new yazl.ZipFile()
  archive.addBuffer(
    Buffer.from('A real archived document '.repeat(4000)),
    'documents/sample.txt',
    { compress: true, compressionLevel: options.compressionLevel ?? 1 },
  )
  archive.addEmptyDirectory('empty-folder/')
  const output = createWriteStream(path)
  archive.outputStream.pipe(output)
  archive.end()
  await finished(output)
}

function extractArchiveEntry(path, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
      if (error) return reject(error)
      archive.on('error', reject)
      archive.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          archive.readEntry()
          return
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError)
          const chunks = []
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => resolve(Buffer.concat(chunks)))
        })
      })
      archive.readEntry()
    })
  })
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 6 ZIP processor', () => {
  it('recompresses a real ZIP archive, verifies its contents, and preserves the source', async () => {
    const root = createWorkspace()
    const inputPath = join(root, 'sample.zip')
    await createArchive(inputPath)
    const original = readFileSync(inputPath)
    const originalHash = createHash('sha256').update(original).digest('hex')
    const inspection = await inspectFile(inputPath)

    const result = await processZipFile({
      inputPath,
      outputFolder: join(root, 'output'),
      expectedInspection: inspection,
    })

    expect(inspection.format).toBe('zip')
    expect(result.status).toBe('completed')
    expect(result.inputFormat).toBe('zip')
    expect(result.outputFormat).toBe('zip')
    expect(result.outputSize).toBeLessThan(result.originalSize)
    expect(await extractArchiveEntry(result.outputPath, 'documents/sample.txt'))
      .toEqual(Buffer.from('A real archived document '.repeat(4000)))
    expect(readFileSync(inputPath)).toEqual(original)
    expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(originalHash)
  })

  it('rejects damaged and unsupported inputs without leaving output, then remains usable', async () => {
    const root = createWorkspace()
    const damagedPath = join(root, 'damaged.zip')
    const unsupportedPath = join(root, 'notes.txt')
    const outputFolder = join(root, 'output')
    writeFileSync(damagedPath, Buffer.from('PK\x03\x04broken'))
    writeFileSync(unsupportedPath, 'not a supported processor input')

    await expect(processZipFile({ inputPath: damagedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(processZipFile({ inputPath: unsupportedPath, outputFolder }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(() => readFileSync(outputFolder)).toThrow()

    const validPath = join(root, 'valid.zip')
    await createArchive(validPath)
    const result = await processZipFile({ inputPath: validPath, outputFolder })
    expect(result.status).toBe('completed')
  })

  it('registers ZIP capabilities only after adding a real processor', () => {
    const registry = new ProcessorRegistry()
    expect(registry.forInput('zip')).toMatchObject({
      id: 'zip',
      inputFormats: ['zip'],
      outputFormats: ['zip'],
    })
    expect(registry.forInput('rar')).toBeNull()
  })
})
