import yauzl from 'yauzl'
import { ProcessingError } from './errors.js'

export function listZipEntries(filePath, { maxEntries = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: true,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, archive) => {
      if (error) {
        reject(new ProcessingError('INVALID_ARCHIVE', 'The ZIP archive is damaged or invalid.', { cause: error }))
        return
      }

      const entries = []
      archive.on('error', (archiveError) => {
        reject(new ProcessingError('INVALID_ARCHIVE', 'The ZIP archive is damaged or invalid.', {
          cause: archiveError,
        }))
      })
      archive.on('entry', (entry) => {
        entries.push(entry.fileName)
        if (entries.length > maxEntries) {
          archive.close()
          reject(new ProcessingError('ARCHIVE_LIMIT_EXCEEDED', 'The archive contains too many entries.'))
          return
        }
        archive.readEntry()
      })
      archive.on('end', () => resolve(entries))
      archive.readEntry()
    })
  })
}
