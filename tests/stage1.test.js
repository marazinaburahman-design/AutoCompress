import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database.js'
import { migrateDatabase } from '../src/main/db/migrations.js'
import { createSettingsRepository, DEFAULT_SETTINGS } from '../src/main/db/settings-repository.js'
import { validateSettingsPatch } from '../src/main/ipc/validate-settings.js'

const temporaryDirectories = []

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-stage1-'))
  temporaryDirectories.push(directory)
  return openDatabase(join(directory, 'app.sqlite'))
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 1 database foundation', () => {
  it('creates all required tables and applies migrations idempotently', () => {
    const database = createTemporaryDatabase()
    migrateDatabase(database)
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map(({ name }) => name)

    expect(tables).toEqual(expect.arrayContaining([
      'application_settings',
      'monitored_folders',
      'automation_rules',
      'processing_jobs',
      'processing_history',
    ]))
    expect(database.pragma('user_version', { simple: true })).toBe(2)
    database.close()
  })

  it('persists validated settings across database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autocompress-persist-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'app.sqlite')

    let database = openDatabase(databasePath)
    const repository = createSettingsRepository(database)
    expect(repository.get()).toEqual(DEFAULT_SETTINGS)
    repository.update({ defaultQuality: 91, notifications: false })
    database.close()

    database = openDatabase(databasePath)
    expect(createSettingsRepository(database).get()).toMatchObject({
      defaultQuality: 91,
      notifications: false,
    })
    database.close()
  })

  it('enforces job status, foreign keys, and history uniqueness', () => {
    const database = createTemporaryDatabase()
    expect(() => database.prepare(`
      INSERT INTO processing_jobs (id, source_path, status) VALUES ('bad', 'x', 'unknown')
    `).run()).toThrow()
    database.prepare(`
      INSERT INTO processing_jobs (id, source_path, status) VALUES ('job', 'x', 'completed')
    `).run()
    const addHistory = database.prepare(`
      INSERT INTO processing_history (id, job_id, source_path, status)
      VALUES (?, 'job', 'x', 'completed')
    `)
    addHistory.run('history-1')
    expect(() => addHistory.run('history-2')).toThrow()
    database.close()
  })
})

describe('IPC settings validation', () => {
  it('accepts supported settings and rejects malformed or unsafe patches', () => {
    expect(validateSettingsPatch({ defaultQuality: 75, theme: 'dark' })).toEqual({
      defaultQuality: 75,
      theme: 'dark',
    })
    for (const payload of [
      null,
      [],
      {},
      { nodeIntegration: true },
      { defaultQuality: 101 },
      { maxConcurrency: 0 },
      { theme: 'custom' },
      { notifications: 'yes' },
    ]) {
      expect(() => validateSettingsPatch(payload)).toThrow(TypeError)
    }
  })
})
