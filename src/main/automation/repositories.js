import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export function createFolderRepository(database) {
  const statements = {
    list: database.prepare('SELECT * FROM monitored_folders ORDER BY created_at'),
    findPath: database.prepare('SELECT * FROM monitored_folders'),
    findId: database.prepare('SELECT * FROM monitored_folders WHERE id = ?'),
    insert: database.prepare(`
      INSERT INTO monitored_folders (id, path, enabled) VALUES (?, ?, 1)
    `),
    setEnabled: database.prepare(`
      UPDATE monitored_folders
      SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `),
    delete: database.prepare('DELETE FROM monitored_folders WHERE id = ?'),
  }

  return {
    list() {
      return statements.list.all().map((folder) => ({ ...folder, enabled: Boolean(folder.enabled) }))
    },
    async add(inputPath) {
      const path = await realpath(resolve(inputPath))
      const details = await stat(path)
      if (!details.isDirectory()) throw new TypeError('Select an existing folder to monitor.')
      const existing = statements.findPath.all().find(
        (folder) => folder.path.toLowerCase() === path.toLowerCase(),
      )
      if (existing) return { ...existing, enabled: Boolean(existing.enabled) }
      const folder = { id: randomUUID(), path, enabled: true }
      statements.insert.run(folder.id, folder.path)
      return folder
    },
    setEnabled(id, enabled) {
      if (statements.setEnabled.run(enabled ? 1 : 0, id).changes !== 1) {
        throw new Error('Watched folder was not found.')
      }
      return this.list().find((folder) => folder.id === id)
    },
    remove(id) {
      if (statements.delete.run(id).changes !== 1) {
        throw new Error('Watched folder was not found.')
      }
    },
  }
}

export function createRuleRepository(database) {
  const statements = {
    list: database.prepare('SELECT * FROM automation_rules ORDER BY priority DESC, created_at'),
    insert: database.prepare(`
      INSERT INTO automation_rules (id, name, enabled, priority, match_json, action_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    update: database.prepare(`
      UPDATE automation_rules SET
        name = ?, enabled = ?, priority = ?, match_json = ?, action_json = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `),
    delete: database.prepare('DELETE FROM automation_rules WHERE id = ?'),
  }

  function toRule(row) {
    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      priority: row.priority,
      match: JSON.parse(row.match_json),
      action: JSON.parse(row.action_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  return {
    list() {
      return statements.list.all().map(toRule)
    },
    save(rule) {
      const existing = database.prepare('SELECT id FROM automation_rules WHERE id = ?').get(rule.id)
      if (existing) {
        if (statements.update.run(
          rule.name,
          rule.enabled ? 1 : 0,
          rule.priority,
          JSON.stringify(rule.match),
          JSON.stringify(rule.action),
          rule.id,
        ).changes !== 1) {
          throw new Error('Automation rule could not be updated.')
        }
      } else {
        statements.insert.run(
          rule.id,
          rule.name,
          rule.enabled ? 1 : 0,
          rule.priority,
          JSON.stringify(rule.match),
          JSON.stringify(rule.action),
        )
      }
      return this.list().find(({ id }) => id === rule.id)
    },
    remove(id) {
      if (statements.delete.run(id).changes !== 1) {
        throw new Error('Automation rule was not found.')
      }
    },
    match(inputFormat) {
      const row = statements.list.all().find((candidate) =>
        candidate.enabled && JSON.parse(candidate.match_json).inputFormat === inputFormat,
      )
      return row ? toRule(row) : null
    },
  }
}
