import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database.js'
import { createJobRepository } from '../src/main/processing/job-repository.js'
import { JobQueue } from '../src/main/processing/job-queue.js'
import { ProcessorRegistry } from '../src/main/processing/processor-registry.js'

const temporaryDirectories = []

function createWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), 'autocompress-queue-'))
  temporaryDirectories.push(directory)
  return directory
}

function waitForTerminalJob(database, id) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      try {
        const job = database.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id)
        if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) {
          clearInterval(poll)
          resolve(job)
        } else if (Date.now() - started > 20000) {
          clearInterval(poll)
          reject(new Error(`Timed out waiting for job ${id}.`))
        }
      } catch (error) {
        clearInterval(poll)
        reject(error)
      }
    }, 20)
  })
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('Stage 2 bounded job queue', () => {
  it('pauses pending work and never exceeds configured concurrency', async () => {
    const root = createWorkspace()
    const database = openDatabase(join(root, 'jobs.sqlite'))
    let active = 0
    let peak = 0
    const registry = new ProcessorRegistry([{
      id: 'test-image',
      name: 'Test image processor',
      kind: 'image',
      inputFormats: ['png'],
      outputFormats: ['webp'],
      supportsInput: (format) => format === 'png',
      supportsOutput: (format) => format === 'webp',
      async process() {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 40))
        active -= 1
        return { outputFormat: 'webp', outputSize: 1, durationMs: 40 }
      },
    }])
    const repository = createJobRepository(database)
    const queue = new JobQueue({ database: repository, registry, concurrency: 2 })
    try {
      queue.pause()
      const inputs = []
      for (let index = 0; index < 6; index += 1) {
        const path = join(root, `image-${index}.png`)
        await sharp({
          create: {
            width: 16,
            height: 8,
            channels: 3,
            background: { r: index * 30, g: 120, b: 200 },
          },
        }).png().toFile(path)
        inputs.push(path)
      }

      const queued = []
      for (const sourcePath of inputs) {
        queued.push(await queue.enqueue({
          sourcePath,
          outputFolder: join(root, 'output'),
          options: { outputFormat: 'webp' },
        }))
      }
      expect(peak).toBe(0)
      queue.resume()
      for (const { id } of queued) await waitForTerminalJob(database, id)
      expect(peak).toBe(2)
      expect(repository.listHistory(10)).toHaveLength(6)
    } finally {
      await queue.close()
      database.close()
    }
  })

  it('records a failed job without stopping later work and deduplicates content', async () => {
    const root = createWorkspace()
    const database = openDatabase(join(root, 'jobs.sqlite'))
    const repository = createJobRepository(database)
    const queue = new JobQueue({
      database: repository,
      registry: new ProcessorRegistry(),
      concurrency: 1,
    })
    try {
      const validInput = join(root, 'valid.png')
      await sharp({
        create: {
          width: 16,
          height: 8,
          channels: 3,
          background: '#2b9080',
        },
      }).png().toFile(validInput)
      const brokenInput = join(root, 'broken.png')
      writeFileSync(brokenInput, (await sharp(validInput).png().toBuffer()).subarray(0, 32))

      const failed = await queue.enqueue({
        sourcePath: brokenInput,
        outputFolder: join(root, 'output'),
        options: { outputFormat: 'webp' },
      })
      const failedJob = await waitForTerminalJob(database, failed.id)
      expect(failedJob.status).toBe('failed')
      expect(repository.listHistory()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          job_id: failed.id,
          status: 'failed',
          error_code: 'INVALID_IMAGE',
        }),
      ]))

      const successful = await queue.enqueue({
        sourcePath: validInput,
        outputFolder: join(root, 'output'),
        options: { outputFormat: 'webp' },
      })
      const completedJob = await waitForTerminalJob(database, successful.id)
      expect(completedJob.status).toBe('completed')

      const duplicateInput = join(root, 'same-content.png')
      writeFileSync(duplicateInput, await sharp(validInput).png().toBuffer())
      const duplicate = await queue.enqueue({
        sourcePath: duplicateInput,
        outputFolder: join(root, 'output'),
        options: { outputFormat: 'webp' },
      })
      expect(duplicate).toEqual({ id: null, duplicate: true })
    } finally {
      queue.close()
      database.close()
    }
  })

  it('enforces bounded concurrency configuration', () => {
    const root = createWorkspace()
    const database = openDatabase(join(root, 'jobs.sqlite'))
    const queue = new JobQueue({
      database: createJobRepository(database),
      registry: new ProcessorRegistry(),
      concurrency: 2,
    })
    expect(queue.concurrency).toBe(2)
    expect(() => queue.setConcurrency(0)).toThrow(RangeError)
    expect(() => queue.setConcurrency(9)).toThrow(RangeError)
    queue.close()
    database.close()
  })
})
