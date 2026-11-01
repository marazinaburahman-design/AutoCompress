import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'

export function createJobRepository(database) {
  const statements = {
    insert: database.prepare(`
      INSERT INTO processing_jobs (
        id, monitored_folder_id, rule_id, source_path, source_fingerprint,
        source_modified_at, input_format, output_format, original_size, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
    `),
    byFingerprint: database.prepare(`
      SELECT id FROM processing_jobs
      WHERE source_fingerprint = ?
        AND status IN ('queued', 'processing', 'completed')
      LIMIT 1
    `),
    markProcessing: database.prepare(`
      UPDATE processing_jobs
      SET status = 'processing', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = 'queued'
    `),
    get: database.prepare('SELECT * FROM processing_jobs WHERE id = ?'),
    complete: database.prepare(`
      UPDATE processing_jobs SET
        status = ?, output_path = ?, output_format = ?, output_size = ?,
        duration_ms = ?, error_code = ?, error_message = ?,
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `),
    addHistory: database.prepare(`
      INSERT INTO processing_history (
        id, job_id, source_path, output_path, input_format, output_format,
        original_size, output_size, space_saved, duration_ms, status,
        error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    recover: database.prepare(`
      SELECT id FROM processing_jobs WHERE status IN ('queued', 'processing')
    `),
    history: database.prepare(`
      SELECT h.*, j.source_fingerprint
      FROM processing_history h
      JOIN processing_jobs j ON j.id = h.job_id
      ORDER BY h.completed_at DESC
      LIMIT ?
    `),
    historyOutput: database.prepare(`
      SELECT output_path
      FROM processing_history
      WHERE id = ? AND status = 'completed'
    `),
    dashboardSummary: database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM processing_jobs WHERE status IN ('completed', 'failed')) AS processedFiles,
        (SELECT COUNT(*) FROM processing_jobs WHERE status = 'completed') AS successfulJobs,
        (SELECT COUNT(*) FROM processing_jobs WHERE status = 'failed') AS failedJobs,
        (SELECT COALESCE(SUM(space_saved), 0) FROM processing_history WHERE status = 'completed') AS spaceSaved
    `),
    currentJobs: database.prepare(`
      SELECT id, source_path, status, created_at
      FROM processing_jobs
      WHERE status IN ('queued', 'processing')
      ORDER BY created_at
    `),
  }

  return {
    create({ sourcePath, inspection, outputFormat, monitoredFolderId = null, ruleId = null }) {
      const id = randomUUID()
      statements.insert.run(
        id,
        monitoredFolderId,
        ruleId,
        sourcePath,
        inspection.fingerprint,
        inspection.modifiedAt,
        inspection.format,
        outputFormat,
        inspection.size,
      )
      return id
    },
    hasFingerprint(fingerprint) {
      return Boolean(statements.byFingerprint.get(fingerprint))
    },
    markProcessing(id) {
      if (statements.markProcessing.run(id).changes !== 1) {
        throw new Error(`Job ${id} is not in the queued state.`)
      }
    },
    finish(id, { status, result = null, error = null }) {
      if (!['completed', 'failed', 'cancelled'].includes(status)) {
        throw new TypeError('Invalid terminal processing status.')
      }
      const job = statements.get.get(id)
      if (!job) throw new Error(`Processing job ${id} was not found.`)
      const outputPath = result?.outputPath ?? null
      const outputFormat = result?.outputFormat ?? job.output_format
      const outputSize = result?.outputSize ?? null
      const durationMs = result?.durationMs ?? null
      const errorCode = error?.code ?? null
      const errorMessage = error?.message ?? null
      database.transaction(() => {
        statements.complete.run(
          status,
          outputPath,
          outputFormat,
          outputSize,
          durationMs,
          errorCode,
          errorMessage,
          id,
        )
        statements.addHistory.run(
          randomUUID(),
          id,
          job.source_path,
          outputPath,
          job.input_format,
          outputFormat,
          job.original_size,
          outputSize,
          outputSize === null ? null : job.original_size - outputSize,
          durationMs,
          status,
          errorCode,
          errorMessage,
        )
      })()
      return statements.get.get(id)
    },
    listHistory(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new RangeError('History limit must be from 1 to 1000.')
      }
      return statements.history.all(limit).map((row) => ({
        ...row,
        original_filename: basename(row.source_path),
        space_saved: row.space_saved ?? 0,
      }))
    },
    getHistoryOutputPath(historyId) {
      return statements.historyOutput.get(historyId)?.output_path ?? null
    },
    getDashboardSummary() {
      return {
        ...statements.dashboardSummary.get(),
        currentJobs: statements.currentJobs.all(),
      }
    },
    recoverInterrupted() {
      const interruptedIds = statements.recover.all().map(({ id }) => id)
      for (const id of interruptedIds) {
        this.finish(id, {
          status: 'failed',
          error: {
            code: 'PROCESS_INTERRUPTED',
            message: 'Processing was interrupted when AutoCompress closed.',
          },
        })
      }
      return interruptedIds.length
    },
  }
}
