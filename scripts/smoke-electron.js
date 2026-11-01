import assert from 'node:assert/strict'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { finished } from 'node:stream/promises'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'
import yazl from 'yazl'

const userDataDirectory = mkdtempSync(join(tmpdir(), 'autocompress-electron-'))
const outputDirectory = join(userDataDirectory, 'output')
const watchedDirectory = join(userDataDirectory, 'watched')
const inputImage = join(userDataDirectory, 'smoke-image.png')
const secondImage = join(userDataDirectory, 'second-image.png')
const droppedImage = join(userDataDirectory, 'dropped-image.png')
const zipInput = join(userDataDirectory, 'smoke-archive.zip')
mkdirSync(outputDirectory)
mkdirSync(watchedDirectory)
const zipArchive = new yazl.ZipFile()
zipArchive.addBuffer(Buffer.from('real archive input for the Electron IPC smoke test'), 'smoke.txt')
const zipOutput = createWriteStream(zipInput)
zipArchive.outputStream.pipe(zipOutput)
zipArchive.end()
await finished(zipOutput)
await Promise.all([
  sharp({
  create: { width: 24, height: 18, channels: 3, background: '#ef4444' },
  }).png().toFile(inputImage),
  sharp({
    create: { width: 32, height: 24, channels: 3, background: '#3b82f6' },
  }).png().toFile(secondImage),
  sharp({
    create: { width: 18, height: 30, channels: 3, background: '#22c55e' },
  }).png().toFile(droppedImage),
])
let application

async function launch() {
  const packagedExecutable = process.env.AUTOCOMPRESS_PACKAGED_EXECUTABLE
  return electron.launch({
    ...(packagedExecutable
      ? { executablePath: packagedExecutable, args: [] }
      : { args: ['.'] }),
    timeout: 60_000,
    env: {
      ...process.env,
      AUTOCOMPRESS_TEST_USER_DATA: userDataDirectory,
    },
  })
}

try {
  application = await launch()
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.autoCompress))

  const environment = await page.evaluate(() => ({
    title: document.title,
    nodeIntegration: typeof window.require !== 'undefined',
    nodeProcess: typeof window.process !== 'undefined',
    bridgeMethods: Object.keys(window.autoCompress).sort(),
  }))
  assert.equal(environment.title, 'AutoCompress')
  assert.equal(environment.nodeIntegration, false)
  assert.equal(environment.nodeProcess, false)
  assert.deepEqual(environment.bridgeMethods, [
    'addWatchedFolder',
    'cancelJob',
    'deleteAutomationRule',
    'getDashboardSummary',
    'getHistory',
    'getProcessorCapabilities',
    'getSettings',
    'getStatus',
    'listAutomationRules',
    'listWatchedFolders',
    'onJobUpdated',
    'onMonitoringStatus',
    'openHistoryOutputLocation',
    'openOutputFolder',
    'pauseMonitoring',
    'processDroppedFiles',
    'quit',
    'removeWatchedFolder',
    'resumeMonitoring',
    'saveAutomationRule',
    'selectFilesForProcessing',
    'selectOutputFolder',
    'setWatchedFolderEnabled',
    'updateSettings',
  ])
  console.log('PASS: Electron renderer loads with no Node or process globals.')

  const status = await page.evaluate(() => window.autoCompress.getStatus())
  assert.equal(status.trayAvailable, true)
  assert.equal(status.platform, 'win32')
  const capabilities = await page.evaluate(() => window.autoCompress.getProcessorCapabilities())
  assert.equal(capabilities.some(({ kind, inputFormats, outputFormats }) =>
    kind === 'image' && inputFormats.includes('png') && outputFormats.includes('webp'),
  ), true)
  console.log('PASS: SQLite-backed Electron startup and tray initialization.')

  const rejectedInvalidIpc = await page.evaluate(async () => {
    try {
      await window.autoCompress.updateSettings({ nodeIntegration: true })
      return false
    } catch (error) {
      return error.message.includes('Invalid settings value')
    }
  })
  assert.equal(rejectedInvalidIpc, true)
  const rejectedInvalidImageOptions = await page.evaluate(async () => {
    try {
      await window.autoCompress.selectFilesForProcessing('image', { outputFormat: 'exe', quality: 80, resize: null })
      return false
    } catch (error) {
      return error.message.includes('Image conversion options are invalid')
    }
  })
  assert.equal(rejectedInvalidImageOptions, true)
  const rejectedUnsupportedProcessorOptions = await page.evaluate(async () => {
    try {
      await window.autoCompress.selectFilesForProcessing('zip', { outputFormat: 'pdf' })
      return false
    } catch (error) {
      return error.message.includes('selected processor does not support')
    }
  })
  assert.equal(rejectedUnsupportedProcessorOptions, true)
  const rejectedInvalidJobId = await page.evaluate(async () => {
    try {
      await window.autoCompress.cancelJob('invalid')
      return false
    } catch (error) {
      return error.message.includes('Processing job ID is invalid')
    }
  })
  assert.equal(rejectedInvalidJobId, true)
  await page.evaluate(() => window.autoCompress.updateSettings({ defaultQuality: 73 }))

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Tune your workspace' }).waitFor()
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, outputDirectory)
  await page.getByRole('button', { name: 'Choose output folder' }).click()
  await page.getByText(outputDirectory, { exact: true }).waitFor()
  await page.getByLabel('Parallel jobs').selectOption('3')
  await page.getByLabel('Theme').selectOption('dark')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await page.getByLabel('Theme').selectOption('system')
  await page.getByRole('checkbox', { name: 'Notifications' }).uncheck({ force: true })
  assert.equal(await page.evaluate(() =>
    window.autoCompress.getSettings().then(({ maxConcurrency }) => maxConcurrency),
  ), 3)
  console.log('PASS: Settings UI updates validated output and processing preferences.')

  await page.getByRole('button', { name: 'Watched folders', exact: true }).click()
  await page.getByRole('button', { name: 'Add folder', exact: true }).waitFor()
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, watchedDirectory)
  await page.getByRole('button', { name: 'Add folder', exact: true }).click()
  await page.getByText('watched', { exact: true }).waitFor()
  await page.getByText('Pause folder', { exact: true }).click()
  await page.getByText('Paused', { exact: true }).waitFor()
  await page.getByText('Enable folder', { exact: true }).click()
  await page.getByText('Monitoring enabled', { exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /^Remove / }).click()
  await page.getByText('No folders are being monitored').waitFor()
  console.log('PASS: Watched-folder add, pause/resume, and remove workflows.')

  await page.getByRole('button', { name: 'Automation', exact: true }).click()
  await page.getByRole('button', { name: 'New rule' }).click()
  await page.getByLabel('Rule name').fill('Smoke PNG to WebP')
  await page.getByLabel('Input format').selectOption('png')
  await page.getByLabel('Output format').selectOption('webp')
  await page.getByText('Resize output (optional)', { exact: true }).click()
  await page.getByLabel('Maximum width').fill('16')
  await page.getByRole('button', { name: 'Create rule', exact: true }).click()
  await page.getByText('Smoke PNG to WebP', { exact: true }).waitFor()
  await page.getByText('Disable Smoke PNG to WebP', { exact: true }).click()
  await page.getByText('Disabled', { exact: true }).waitFor()
  await page.getByText('Enable Smoke PNG to WebP', { exact: true }).click()
  await page.getByRole('button', { name: 'Edit Smoke PNG to WebP' }).click()
  await page.getByLabel('Rule name').fill('Smoke image conversion')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Smoke image conversion', { exact: true }).waitFor()
  console.log('PASS: Automation rule create, enable/disable, and edit workflows.')

  await page.getByRole('button', { name: 'File Processing', exact: true }).click()
  await page.getByRole('heading', { name: 'Process files' }).waitFor()
  await page.getByLabel('Processing output format').selectOption('webp')
  await page.getByLabel('Processing quality').fill('76')
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selectedPath })
  }, [inputImage, secondImage])
  await page.getByRole('button', { name: 'Choose files' }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('smoke-image.png', { exact: true }).waitFor({ timeout: 30_000 })
  assert.equal(await page.getByRole('row').filter({ hasText: 'smoke-image.png' }).getByText('Completed').count(), 1)
  await page.getByText('second-image.png', { exact: true }).waitFor()
  await application.evaluate(({ shell }) => {
    shell.showItemInFolder = (outputPath) => { globalThis.__openedOutputPath = outputPath }
  })
  await page.getByRole('button', { name: 'Open output location for smoke-image.png' }).click()
  const openedOutputPath = await application.evaluate(() => globalThis.__openedOutputPath)
  assert.equal(basename(openedOutputPath), 'smoke-image.webp')
  console.log('PASS: Multiple native-selected images convert and History opens the output location.')

  await page.getByRole('button', { name: 'File Processing', exact: true }).click()
  await page.getByLabel('Processing input type').selectOption('zip')
  await page.getByRole('button', { name: 'Choose files' }).waitFor()
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, zipInput)
  await page.getByRole('button', { name: 'Choose files' }).click()
  await page.getByText('smoke-archive.zip', { exact: true }).waitFor({ timeout: 30_000 })
  const zipHistory = (await page.evaluate(() => window.autoCompress.getHistory()))
    .find(({ original_filename }) => original_filename === 'smoke-archive.zip')
  assert.ok(zipHistory, `ZIP history row missing: ${JSON.stringify(await page.evaluate(() => window.autoCompress.getHistory()))}`)
  assert.equal(zipHistory.status, 'completed', zipHistory.error_message ?? 'The ZIP job did not complete.')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('row').filter({ hasText: 'smoke-archive.zip' }).getByText('Completed').waitFor()
  assert.equal(existsSync(join(outputDirectory, 'smoke-archive.zip')), true)
  console.log('PASS: Generic file-selection IPC processes a real ZIP archive.')

  await page.getByRole('button', { name: 'File Processing', exact: true }).click()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'electron-drag-test-source'
    document.body.append(input)
  })
  await page.locator('#electron-drag-test-source').setInputFiles(droppedImage)
  await page.evaluate(() => {
    const source = document.getElementById('electron-drag-test-source')
    const transfer = new DataTransfer()
    transfer.items.add(source.files[0])
    document.querySelector('[aria-label="Drop Images to process"]').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    )
    source.remove()
  })
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('dropped-image.png', { exact: true }).waitFor({ timeout: 30_000 })
  assert.equal(await page.getByRole('row').filter({ hasText: 'dropped-image.png' }).getByText('Completed').count(), 1)
  await page.getByRole('button', { name: 'Supported Formats', exact: true }).click()
  await page.getByRole('heading', { name: 'Supported formats and operations' }).waitFor()
  await page.getByRole('heading', { name: 'ZIP archive processor' }).waitFor()
  await page.getByText('Not implemented', { exact: true }).first().waitFor()
  console.log('PASS: Drag/drop file processing and live supported-format reporting.')

  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const summary = await page.evaluate(() => window.autoCompress.getDashboardSummary())
  assert.equal(summary.processedFiles, 4)
  assert.equal(summary.successfulJobs, 4)
  assert.equal(summary.failedJobs, 0)
  assert.equal(summary.currentJobs.length, 0)
  await page.getByText('Files processed', { exact: true }).waitFor()
  console.log('PASS: Dashboard shows real processing totals and current-job counts.')

  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('heading', { name: 'Review your processing history' }).waitFor()
  await page.getByLabel('Search history').fill('no-such-image')
  await page.getByText('No matching history').waitFor()
  await page.getByLabel('Search history').fill('')
  await page.getByLabel('Filter by status').selectOption('failed')
  await page.getByText('No matching history').waitFor()
  console.log('PASS: History search and status filters.')

  await application.close()
  application = await launch()
  const restartedPage = await application.firstWindow()
  await restartedPage.waitForFunction(() => Boolean(window.autoCompress))
  const persisted = await restartedPage.evaluate(async () => ({
    settings: await window.autoCompress.getSettings(),
    rules: await window.autoCompress.listAutomationRules(),
    history: await window.autoCompress.getHistory(),
  }))
  assert.equal(persisted.settings.defaultQuality, 73)
  assert.equal(persisted.settings.maxConcurrency, 3)
  assert.equal(persisted.settings.notifications, false)
  assert.equal(persisted.settings.defaultOutputFolder, outputDirectory)
  assert.equal(persisted.rules.some(({ name }) => name === 'Smoke image conversion'), true)
  assert.equal(persisted.history.filter(({ status }) => status === 'completed').length, 4)
  await restartedPage.getByRole('button', { name: 'Automation', exact: true }).click()
  restartedPage.once('dialog', (dialog) => dialog.accept())
  await restartedPage.getByRole('button', { name: 'Delete Smoke image conversion' }).click()
  assert.equal((await restartedPage.evaluate(() => window.autoCompress.listAutomationRules())).length, 0)
  console.log('PASS: Settings, rules, and processing history survive restart; rule deletion workflow.')
} finally {
  if (application) await application.close()
  rmSync(userDataDirectory, { recursive: true, force: true })
}
