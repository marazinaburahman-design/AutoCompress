import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const installerPath = join(root, 'release', `AutoCompress-${packageJson.version}-x64.exe`)
const installationDirectory = mkdtempSync(join(tmpdir(), 'autocompress-installed-'))
const applicationPath = join(installationDirectory, 'AutoCompress.exe')
const uninstallerPath = join(installationDirectory, 'Uninstall AutoCompress.exe')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 240_000,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}.\n${result.stdout}\n${result.stderr}`)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result
}

try {
  assert.equal(existsSync(installerPath), true, `Installer is missing: ${installerPath}`)
  run(installerPath, ['/S', `/D=${installationDirectory}`])
  assert.equal(existsSync(applicationPath), true, 'The installer did not place AutoCompress.exe.')
  assert.equal(existsSync(uninstallerPath), true, 'The installer did not create its uninstaller.')
  console.log('PASS: NSIS installer places the application and uninstaller.')

  run(process.execPath, ['scripts/smoke-electron.js'], {
    env: {
      ...process.env,
      AUTOCOMPRESS_PACKAGED_EXECUTABLE: applicationPath,
    },
  })
  console.log('PASS: Installed application launches and passes SQLite, Sharp, automation, and UI workflows.')

  run(uninstallerPath, ['/S'])
  for (
    let attempt = 0;
    attempt < 30 && existsSync(installationDirectory) && readdirSync(installationDirectory).length > 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.equal(
    existsSync(installationDirectory) && readdirSync(installationDirectory).length > 0,
    false,
    'The uninstaller left application files behind.',
  )
  console.log('PASS: Silent uninstall removes installed application files.')
} finally {
  if (existsSync(installationDirectory)) {
    rmSync(installationDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 500,
    })
  }
}
