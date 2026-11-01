import { SaxesParser } from 'saxes'
import yauzl from 'yauzl'
import { ProcessingError } from './errors.js'
import { inspectFile } from './inspect-file.js'
import { processZipFile } from './zip-processor.js'

const officeFormats = Object.freeze(['docx', 'xlsx', 'pptx'])
const maxXmlPartBytes = 16 * 1024 * 1024
const maxDocumentEntries = 10000
const documentParts = Object.freeze({
  docx: [
    ['[Content_Types].xml', 'Types', 'http://schemas.openxmlformats.org/package/2006/content-types'],
    ['_rels/.rels', 'Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships'],
    ['word/document.xml', 'document', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'],
  ],
  xlsx: [
    ['[Content_Types].xml', 'Types', 'http://schemas.openxmlformats.org/package/2006/content-types'],
    ['_rels/.rels', 'Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships'],
    ['xl/workbook.xml', 'workbook', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'],
  ],
  pptx: [
    ['[Content_Types].xml', 'Types', 'http://schemas.openxmlformats.org/package/2006/content-types'],
    ['_rels/.rels', 'Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships'],
    ['ppt/presentation.xml', 'presentation', 'http://schemas.openxmlformats.org/presentationml/2006/main'],
  ],
})

export async function processDocumentFile({
  inputPath,
  outputFolder,
  expectedInspection,
  outputFormat,
}, context = {}) {
  const inspection = expectedInspection ?? await inspectFile(inputPath)
  if (!officeFormats.includes(inspection.format)) {
    throw new ProcessingError('UNSUPPORTED_INPUT_FORMAT', 'Only validated OOXML documents are supported.')
  }
  if (outputFormat !== inspection.format) {
    throw new ProcessingError('UNSUPPORTED_OUTPUT_FORMAT', 'Office documents can only be recompressed to their original format.')
  }
  await validateOfficePackage(inspection.path, inspection.format)
  const result = await processZipFile({
    inputPath,
    outputFolder,
    expectedInspection: inspection,
    allowedFormats: officeFormats,
  }, context)
  return result
}

async function validateOfficePackage(filePath, format) {
  const entries = await listEntries(filePath)
  const names = entries.map(({ fileName }) => fileName.toLowerCase())
  if (new Set(names).size !== names.length) {
    throw new ProcessingError('INVALID_DOCUMENT', 'The Office package contains duplicate entry names.')
  }
  for (const [partName, rootName, namespace] of documentParts[format]) {
    if (!entries.some(({ fileName }) => fileName === partName)) {
      throw new ProcessingError('INVALID_DOCUMENT', 'The Office package is missing a required document part.')
    }
    await validateXmlEntry(filePath, partName, rootName, namespace)
  }
}

function listEntries(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: true,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, archive) => {
      if (error) {
        reject(new ProcessingError('INVALID_ARCHIVE', 'The Office package is damaged or invalid.', { cause: error }))
        return
      }
      const entries = []
      archive.on('error', (archiveError) => {
        reject(new ProcessingError('INVALID_ARCHIVE', 'The Office package is damaged or invalid.', {
          cause: archiveError,
        }))
      })
      archive.on('entry', (entry) => {
        entries.push(entry)
        if (entries.length > maxDocumentEntries) {
          archive.close()
          reject(new ProcessingError('DOCUMENT_LIMIT_EXCEEDED', 'The Office package contains too many entries.'))
          return
        }
        archive.readEntry()
      })
      archive.on('end', () => resolve(entries))
      archive.readEntry()
    })
  })
}

function validateXmlEntry(filePath, targetName, expectedName, expectedNamespace) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, archive) => {
      if (error) {
        reject(new ProcessingError('INVALID_ARCHIVE', 'The Office package is damaged or invalid.', { cause: error }))
        return
      }
      let settled = false
      let activeStream
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        activeStream?.destroy()
        archive.close()
        callback(value)
      }
      archive.on('error', (archiveError) => {
        finish(reject, new ProcessingError('INVALID_ARCHIVE', 'The Office package is damaged or invalid.', {
          cause: archiveError,
        }))
      })
      archive.on('entry', (entry) => {
        if (entry.fileName !== targetName) {
          archive.readEntry()
          return
        }
        if (entry.uncompressedSize > maxXmlPartBytes) {
          finish(reject, new ProcessingError('DOCUMENT_LIMIT_EXCEEDED', 'An Office XML part exceeds the safe size limit.'))
          return
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            finish(reject, new ProcessingError('INVALID_ARCHIVE', 'The Office package is damaged or invalid.', {
              cause: streamError,
            }))
            return
          }
          activeStream = stream
          let size = 0
          let root = null
          let depth = 0
          let elementCount = 0
          let parseError = null
          const parser = new SaxesParser({ xmlns: true })
          const decoder = new TextDecoder('utf-8', { fatal: true })
          parser.on('doctype', () => {
            throw new ProcessingError('INVALID_DOCUMENT', 'Office XML must not contain a document type declaration.')
          })
          parser.on('opentag', (tag) => {
            elementCount += 1
            depth += 1
            if (depth > 256 || elementCount > 1_000_000) {
              throw new ProcessingError('DOCUMENT_LIMIT_EXCEEDED', 'An Office XML part exceeds safe structural limits.')
            }
            if (depth === 1) root = { name: tag.local, namespace: tag.uri }
          })
          parser.on('closetag', () => { depth -= 1 })
          parser.on('error', (parseFailure) => {
            parseError = new ProcessingError('INVALID_DOCUMENT', 'An Office XML part is malformed.', {
              cause: parseFailure,
            })
          })
          stream.on('data', (chunk) => {
            size += chunk.length
            if (size > maxXmlPartBytes) {
              stream.destroy(new ProcessingError('DOCUMENT_LIMIT_EXCEEDED', 'An Office XML part exceeds the safe size limit.'))
              return
            }
            try {
              parser.write(decoder.decode(chunk, { stream: true }))
              if (parseError) throw parseError
            } catch (parseFailure) {
              stream.destroy(parseFailure)
            }
          })
          stream.once('error', (streamReadError) => {
            finish(reject, streamReadError instanceof ProcessingError
              ? streamReadError
              : streamReadError instanceof TypeError
                ? new ProcessingError('INVALID_DOCUMENT', 'An Office XML part is not valid UTF-8.', { cause: streamReadError })
                : new ProcessingError('INVALID_ARCHIVE', 'An Office XML part could not be read.', { cause: streamReadError }))
          })
          stream.once('end', () => {
            try {
              parser.write(decoder.decode()).close()
              if (parseError) throw parseError
              if (root?.name !== expectedName || root?.namespace !== expectedNamespace) {
                throw new ProcessingError('INVALID_DOCUMENT', 'An Office XML part has an unexpected root element.')
              }
              finish(resolve)
            } catch (parseFailure) {
              finish(reject, parseFailure instanceof ProcessingError
                ? parseFailure
                : new ProcessingError('INVALID_DOCUMENT', 'An Office XML part is malformed.', { cause: parseFailure }))
            }
          })
        })
      })
      archive.on('end', () => {
        finish(reject, new ProcessingError('INVALID_DOCUMENT', 'The Office package is missing a required document part.'))
      })
      archive.readEntry()
    })
  })
}
