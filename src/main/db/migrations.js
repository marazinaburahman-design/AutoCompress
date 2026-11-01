const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE application_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE monitored_folders (
        id TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE automation_rules (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        priority INTEGER NOT NULL DEFAULT 0,
        match_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE processing_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        monitored_folder_id TEXT REFERENCES monitored_folders(id) ON DELETE SET NULL,
        rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,
        source_path TEXT NOT NULL,
        source_fingerprint TEXT,
        input_format TEXT,
        output_format TEXT,
        output_path TEXT,
        original_size INTEGER CHECK (original_size IS NULL OR original_size >= 0),
        output_size INTEGER CHECK (output_size IS NULL OR output_size >= 0),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE processing_history (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        output_path TEXT,
        input_format TEXT,
        output_format TEXT,
        original_size INTEGER CHECK (original_size IS NULL OR original_size >= 0),
        output_size INTEGER CHECK (output_size IS NULL OR output_size >= 0),
        space_saved INTEGER,
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
        error_code TEXT,
        error_message TEXT,
        completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX idx_monitored_folders_enabled ON monitored_folders(enabled);
      CREATE INDEX idx_automation_rules_enabled_priority ON automation_rules(enabled, priority DESC);
      CREATE INDEX idx_processing_jobs_status_created ON processing_jobs(status, created_at);
      CREATE INDEX idx_processing_history_completed ON processing_history(completed_at DESC);
      CREATE INDEX idx_processing_jobs_fingerprint ON processing_jobs(source_fingerprint);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE processing_jobs ADD COLUMN source_modified_at TEXT;
      CREATE UNIQUE INDEX uq_processing_jobs_active_fingerprint
        ON processing_jobs(source_fingerprint)
        WHERE source_fingerprint IS NOT NULL
          AND status IN ('queued', 'processing', 'completed');
      CREATE INDEX idx_processing_jobs_source_path
        ON processing_jobs(source_path, source_modified_at);
    `,
  },
]

export function migrateDatabase(database) {
  const currentVersion = database.pragma('user_version', { simple: true })
  const pending = migrations.filter(({ version }) => version > currentVersion)

  for (const migration of pending) {
    database.transaction(() => {
      database.exec(migration.sql)
      database.pragma(`user_version = ${migration.version}`)
    })()
  }
}
