const validators = {
  theme: (value) => ['system', 'light', 'dark'].includes(value),
  defaultOutputFolder: (value) =>
    typeof value === 'string' && value.length <= 32767 && !value.includes('\0'),
  defaultQuality: (value) => Number.isInteger(value) && value >= 1 && value <= 100,
  maxConcurrency: (value) => Number.isInteger(value) && value >= 1 && value <= 8,
  notifications: (value) => typeof value === 'boolean',
  launchAtStartup: (value) => typeof value === 'boolean',
  minimizeToTray: (value) => typeof value === 'boolean',
}

export function validateSettingsPatch(payload) {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length === 0
  ) {
    throw new TypeError('Settings update must be a non-empty object.')
  }

  for (const [key, value] of Object.entries(payload)) {
    const validate = validators[key]
    if (!validate || !validate(value)) {
      throw new TypeError(`Invalid settings value: ${key}.`)
    }
  }

  return payload
}
