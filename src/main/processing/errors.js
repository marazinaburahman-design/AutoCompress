export class ProcessingError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'ProcessingError'
    this.code = code
  }
}

export function toErrorDetails(error) {
  if (error instanceof ProcessingError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: typeof error?.code === 'string' ? error.code : 'PROCESSING_FAILED',
    message: 'The file could not be processed.',
  }
}
