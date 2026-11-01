export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  defaultOutputFolder: '',
  defaultQuality: 80,
  maxConcurrency: 2,
  notifications: true,
  launchAtStartup: false,
  minimizeToTray: true,
})

export function createSettingsRepository(database) {
  const readAll = database.prepare('SELECT key, value_json FROM application_settings')
  const upsert = database.prepare(`
    INSERT INTO application_settings (key, value_json, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `)

  return {
    get() {
      const settings = { ...DEFAULT_SETTINGS }
      for (const row of readAll.all()) {
        settings[row.key] = JSON.parse(row.value_json)
      }
      return settings
    },
    update(patch) {
      database.transaction(() => {
        for (const [key, value] of Object.entries(patch)) {
          upsert.run(key, JSON.stringify(value))
        }
      })()
      return this.get()
    },
  }
}
