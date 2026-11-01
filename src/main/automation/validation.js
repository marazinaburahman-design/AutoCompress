import { randomUUID } from 'node:crypto'

const imageInputs = new Set(['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp'])
const imageOutputs = new Set(['png', 'jpeg', 'webp', 'avif', 'tiff'])

export function validateRule(payload) {
  const allowedKeys = ['id', 'name', 'enabled', 'priority', 'match', 'action']
  if (!isPlainRecord(payload) || Object.keys(payload).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('Automation rule must contain only supported fields.')
  }
  const id = payload.id ?? randomUUID()
  if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) {
    throw new TypeError('Automation rule ID is invalid.')
  }
  if (typeof payload.name !== 'string' || payload.name.trim().length < 1 || payload.name.trim().length > 120) {
    throw new TypeError('Rule name must be from 1 to 120 characters.')
  }
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    throw new TypeError('Rule enabled state must be a boolean.')
  }
  const priority = payload.priority ?? 0
  if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
    throw new TypeError('Rule priority must be from 0 to 10000.')
  }
  if (
    !isPlainRecord(payload.match) ||
    Object.keys(payload.match).some((key) => key !== 'inputFormat') ||
    !imageInputs.has(payload.match.inputFormat)
  ) {
    throw new TypeError('Rule input format is not supported.')
  }
  if (!isPlainRecord(payload.action)) {
    throw new TypeError('Rule action is invalid.')
  }
  const actionKeys = ['outputFormat', 'quality', 'resize']
  if (Object.keys(payload.action).some((key) => !actionKeys.includes(key))) {
    throw new TypeError('Rule action contains an unsupported field.')
  }
  if (!imageOutputs.has(payload.action.outputFormat)) {
    throw new TypeError('Rule output format is not supported.')
  }
  const quality = payload.action.quality ?? 80
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new TypeError('Rule quality must be from 1 to 100.')
  }

  const resize = payload.action.resize ?? null
  if (resize !== null) {
    if (!isPlainRecord(resize)) throw new TypeError('Rule resize dimensions are invalid.')
    const dimensions = Object.entries(resize)
    if (
      dimensions.length < 1 ||
      dimensions.length > 2 ||
      dimensions.some(([key, value]) =>
        !['width', 'height'].includes(key) ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 32768,
      )
    ) {
      throw new TypeError('Rule resize dimensions must be from 1 to 32768 pixels.')
    }
  }

  return {
    id,
    name: payload.name.trim(),
    enabled: payload.enabled ?? true,
    priority,
    match: { inputFormat: payload.match.inputFormat },
    action: {
      outputFormat: payload.action.outputFormat,
      quality,
      resize,
    },
  }
}

export function validateFolderId(id) {
  if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) {
    throw new TypeError('Watched folder ID is invalid.')
  }
  return id
}

export function validateEnabled(enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('Enabled state must be a boolean.')
  return enabled
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
