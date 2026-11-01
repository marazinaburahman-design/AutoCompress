import { processImageFile } from './image-processor.js'
import { processZipFile } from './zip-processor.js'
import { processPdfFile } from './pdf-processor.js'
import { processAudioFile } from './audio-processor.js'
import { processVideoFile } from './video-processor.js'
import { processDocumentFile } from './document-processor.js'

const imageInputs = Object.freeze(['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp'])
const imageOutputs = Object.freeze(['png', 'jpeg', 'webp', 'avif', 'tiff'])

export const imageProcessor = Object.freeze({
  id: 'image',
  name: 'Image processor',
  kind: 'image',
  inputFormats: imageInputs,
  outputFormats: imageOutputs,
  supportsInput(format) {
    return imageInputs.includes(format)
  },
  supportsOutput(format) {
    return imageOutputs.includes(format)
  },
  process(job, context) {
    return processImageFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      outputFormat: job.options.outputFormat,
      quality: job.options.quality,
      resize: job.options.resize ?? null,
      expectedInspection: job.inspection,
    }, context)
  },
})

export const zipProcessor = Object.freeze({
  id: 'zip',
  name: 'ZIP archive processor',
  kind: 'archive',
  inputFormats: Object.freeze(['zip']),
  outputFormats: Object.freeze(['zip']),
  supportsInput(format) {
    return this.inputFormats.includes(format)
  },
  supportsOutput(format) {
    return this.outputFormats.includes(format)
  },
  process(job, context) {
    return processZipFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      expectedInspection: job.inspection,
    }, context)
  },
})

export const pdfProcessor = Object.freeze({
  id: 'pdf',
  name: 'PDF processor',
  kind: 'document',
  inputFormats: Object.freeze(['pdf']),
  outputFormats: Object.freeze(['pdf']),
  supportsInput(format) {
    return this.inputFormats.includes(format)
  },
  supportsOutput(format) {
    return this.outputFormats.includes(format)
  },
  process(job, context) {
    return processPdfFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      expectedInspection: job.inspection,
    }, context)
  },
})

export const audioProcessor = Object.freeze({
  id: 'audio',
  name: 'WAV audio processor',
  kind: 'audio',
  inputFormats: Object.freeze(['wav']),
  outputFormats: Object.freeze(['wav']),
  supportsInput(format) {
    return this.inputFormats.includes(format)
  },
  supportsOutput(format) {
    return this.outputFormats.includes(format)
  },
  process(job, context) {
    return processAudioFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      expectedInspection: job.inspection,
    }, context)
  },
})

export const videoProcessor = Object.freeze({
  id: 'video',
  name: 'MP4 video processor',
  kind: 'video',
  inputFormats: Object.freeze(['mp4']),
  outputFormats: Object.freeze(['mp4']),
  supportsInput(format) {
    return this.inputFormats.includes(format)
  },
  supportsOutput(format) {
    return this.outputFormats.includes(format)
  },
  process(job, context) {
    return processVideoFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      expectedInspection: job.inspection,
    }, context)
  },
})

export const documentProcessor = Object.freeze({
  id: 'document',
  name: 'Office document processor',
  kind: 'document',
  inputFormats: Object.freeze(['docx', 'xlsx', 'pptx']),
  outputFormats: Object.freeze(['docx', 'xlsx', 'pptx']),
  supportsInput(format) {
    return this.inputFormats.includes(format)
  },
  supportsOutput(format) {
    return this.outputFormats.includes(format)
  },
  supportsConversion(inputFormat, outputFormat) {
    return this.inputFormats.includes(inputFormat) && inputFormat === outputFormat
  },
  process(job, context) {
    return processDocumentFile({
      inputPath: job.sourcePath,
      outputFolder: job.outputFolder,
      expectedInspection: job.inspection,
      outputFormat: job.options.outputFormat,
    }, context)
  },
})

export class ProcessorRegistry {
  #processors = new Map()

  constructor(processors = [
    imageProcessor,
    zipProcessor,
    pdfProcessor,
    audioProcessor,
    videoProcessor,
    documentProcessor,
  ]) {
    for (const processor of processors) this.register(processor)
  }

  register(processor) {
    if (
      !processor ||
      typeof processor.id !== 'string' ||
      typeof processor.supportsInput !== 'function' ||
      typeof processor.supportsOutput !== 'function' ||
      typeof processor.process !== 'function'
    ) {
      throw new TypeError('Processor does not satisfy the processor contract.')
    }
    if (this.#processors.has(processor.id)) {
      throw new Error(`Processor "${processor.id}" is already registered.`)
    }
    this.#processors.set(processor.id, Object.freeze(processor))
  }

  forInput(format) {
    return [...this.#processors.values()].find((processor) => processor.supportsInput(format)) ?? null
  }

  get(id) {
    return this.#processors.get(id) ?? null
  }

  capabilities() {
    return [...this.#processors.values()].map(({ id, name, kind, inputFormats, outputFormats }) => ({
      id,
      name,
      kind,
      inputFormats: [...inputFormats],
      outputFormats: [...outputFormats],
    }))
  }
}
