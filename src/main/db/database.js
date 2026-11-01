import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { migrateDatabase } from './migrations.js'

export function openDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('busy_timeout = 5000')
  migrateDatabase(database)
  return database
}
