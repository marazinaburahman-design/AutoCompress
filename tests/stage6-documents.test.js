import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFile } from '../src/main/processing/inspect-file.js'
import { processDocumentFile } from '../src/main/processing/document-processor.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []
const documentSpecs = {
  docx: {
    mainPart: 'word/document.xml',
    root: 'document',
    namespace: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    body: '<w:body><w:p><w:r><w:t>Verified document text</w:t></w:r></w:p></w:body>',
  },
  xlsx: {
    mainPart: 'xl/workbook.xml',
    root: 'workbook',
    namespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    body: '<s:sheets/>',
  },
  pptx: {
    mainPart: 'ppt/presentation.xml',
    root: 'presentation',
    namespace: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    body: '<p:sldIdLst/>',
  },
}

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage6-document-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createOfficePackage(path, format, { malformed = false, doctype = false } = {}) {
  const spec = documentSpecs[format]
  const relationTarget = spec.mainPart
  const prefix = doctype ? `<!DOCTYPE ${formatPrefix(format)}:${spec.root} [ <!ENTITY sample "sample"> ]>` : ''
  const documentXml = malformed
    ? `<${spec.root}`
    : `<?xml version="1.0" encoding="UTF-8"?>${prefix}<${formatPrefix(format)}:${spec.root} xmlns:${formatPrefix(format)}="${spec.namespace}">${spec.body}</${formatPrefix(format)}:${spec.root}>`
  const archive = new yazl.ZipFile()
  archive.addBuffer(Buffer.from(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${spec.mainPart}" ContentType="${spec.type}"/></Types>`,
  ), '[Content_Types].xml')
  archive.addBuffer(Buffer.from(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${relationTarget}"/></Relationships>`,
  ), '_rels/.rels')
  archive.addBuffer(Buffer.from(documentXml), spec.mainPart)
  archive.addBuffer(Buffer.from('test resource bytes'), 'custom/extra.bin')
  const output = createWriteStream(path)
  archive.outputStream.pipe(output)
  archive.end()
  await finished(output)
}

function formatPrefix(format) {
  return { docx: 'w', xlsx: 's', pptx: 'p' }[format]
}

function readZipEntry(path, target) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
      if (error) return reject(error)
      archive.on('error', reject)
      archive.on('entry', (entry) => {
        if (entry.fileName !== target) {
          archive.readEntry()
          return
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError)
          const chunks = []
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => {
            archive.close()
            resolve(Buffer.concat(chunks))
          })
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

describe('Stage 6 Office document processor', () => {
  it.each(['docx', 'xlsx', 'pptx'])('recompresses a real %s package without changing its XML or source', async (format) => {
    const root = createWorkspace()
    const inputPath = join(root, `sample.${format}`)
    await createOfficePackage(inputPath, format)
    const original = readFileSync(inputPath)
    const originalHash = createHash('sha256').update(original).digest('hex')
    const inspection = await inspectFile(inputPath)

    const result = await processDocumentFile({
      inputPath,
      outputFolder: join(root, 'output'),
      expectedInspection: inspection,
      outputFormat: format,
    })

    expect(inspection.format).toBe(format)
    expect(result.status).toBe('completed')
    expect(result.inputFormat).toBe(format)
    expect(result.outputFormat).toBe(format)
    expect(await readZipEntry(result.outputPath, documentSpecs[format].mainPart))
      .toEqual(await readZipEntry(inputPath, documentSpecs[format].mainPart))
    expect(await readZipEntry(result.outputPath, 'custom/extra.bin')).toEqual(Buffer.from('test resource bytes'))
    expect(readFileSync(inputPath)).toEqual(original)
    expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(originalHash)
  })

  it('rejects malformed or unsupported packages without creating output, then recovers', async () => {
    const root = createWorkspace()
    const outputFolder = join(root, 'output')
    const malformedPath = join(root, 'broken.docx')
    const doctypePath = join(root, 'doctype.docx')
    const archivePath = join(root, 'archive.zip')
    await createOfficePackage(malformedPath, 'docx', { malformed: true })
    await createOfficePackage(doctypePath, 'docx', { doctype: true })
    const archive = new yazl.ZipFile()
    archive.addBuffer(Buffer.from('plain archive'), 'readme.txt')
    const output = createWriteStream(archivePath)
    archive.outputStream.pipe(output)
    archive.end()
    await finished(output)

    await expect(processDocumentFile({
      inputPath: malformedPath,
      outputFolder,
      outputFormat: 'docx',
    })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(processDocumentFile({
      inputPath: doctypePath,
      outputFolder,
      outputFormat: 'docx',
    })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(processDocumentFile({
      inputPath: archivePath,
      outputFolder,
      outputFormat: 'docx',
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT_FORMAT' })
    expect(existsSync(outputFolder)).toBe(false)

    const validPath = join(root, 'valid.docx')
    await createOfficePackage(validPath, 'docx')
    const result = await processDocumentFile({
      inputPath: validPath,
      outputFolder,
      outputFormat: 'docx',
    })
    expect(result.status).toBe('completed')
  })

  it('registers only Office formats with a verified same-format operation', () => {
    const registry = new ProcessorRegistry()
    const processor = registry.forInput('docx')
    expect(processor).toMatchObject({
      id: 'document',
      inputFormats: ['docx', 'xlsx', 'pptx'],
      outputFormats: ['docx', 'xlsx', 'pptx'],
    })
    expect(processor.supportsConversion('docx', 'docx')).toBe(true)
    expect(processor.supportsConversion('docx', 'xlsx')).toBe(false)
  })
})
