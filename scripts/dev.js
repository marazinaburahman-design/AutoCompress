import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const electronExecutable = require('electron')
const children = []
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
  process.exitCode = code
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop())
}

const renderer = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
  stdio: 'inherit',
})
children.push(renderer)
renderer.on('exit', (code) => {
  if (!stopping) stop(code ?? 1)
})

async function waitForRenderer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (renderer.exitCode !== null) throw new Error('Vite exited before becoming ready.')
    try {
      const response = await fetch('http://127.0.0.1:5173')
      if (response.ok) return
    } catch {
      await delay(250)
    }
  }
  throw new Error('Vite did not become ready within 30 seconds.')
}

try {
  await waitForRenderer()
  if (stopping) process.exit(1)
  const electron = spawn(electronExecutable, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  })
  children.push(electron)
  electron.on('exit', (code) => stop(code ?? 0))
} catch (error) {
  console.error(error.message)
  stop(1)
}
