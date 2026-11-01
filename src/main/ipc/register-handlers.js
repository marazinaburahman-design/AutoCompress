import { dialog, ipcMain, shell } from 'electron'
import { lstat, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { validateSettingsPatch } from './validate-settings.js'
import { validateEnabled, validateFolderId, validateRule } from '../automation/validation.js'

export function registerIpcHandlers({
  getMainWindow,
  settingsRepository,
  getStatus,
  setLaunchAtStartup,
  setJobConcurrency,
  folderRepository,
  ruleRepository,
  watcherService,
  jobRepository,
  jobQueue,
  processorRegistry,
  quit,
}) {
  ipcMain.handle('settings:get', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return settingsRepository.get()
  })

  ipcMain.handle('settings:update', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const patch = validateSettingsPatch(args[0])
    const settings = settingsRepository.update(patch)
    if ('launchAtStartup' in patch) {
      setLaunchAtStartup(patch.launchAtStartup)
    }
    if ('maxConcurrency' in patch) {
      setJobConcurrency(patch.maxConcurrency)
    }
    return settings
  })

  ipcMain.handle('settings:select-output-folder', async (event, ...args) => {
    const mainWindow = assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose output folder',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:get-status', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return getStatus()
  })

  ipcMain.handle('dashboard:get-summary', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return jobRepository.getDashboardSummary()
  })

  ipcMain.handle('processors:list-capabilities', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return processorRegistry.capabilities()
  })

  ipcMain.handle('app:quit', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    quit()
  })

  ipcMain.handle('app:open-output-folder', async (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    const outputPath = settingsRepository.get().defaultOutputFolder
    if (!outputPath) throw new Error('Choose an output folder in Settings first.')
    const details = await stat(outputPath)
    if (!details.isDirectory()) throw new Error('The configured output path is not a folder.')
    const error = await shell.openPath(outputPath)
    if (error) throw new Error(error)
    return true
  })

  ipcMain.handle('files:select-and-queue', async (event, ...args) => {
    const mainWindow = assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const payload = args[0]
    if (
      !isPlainRecord(payload) ||
      Object.keys(payload).length !== 2 ||
      typeof payload.inputType !== 'string' ||
      !isPlainRecord(payload.options)
    ) {
      throw new TypeError('File processing options are invalid.')
    }
    const { processor, formats } = resolveProcessingInput(payload.inputType, processorRegistry)
    const options = validateProcessingOptions(payload.options, payload.inputType, processor)

    const settings = settingsRepository.get()
    if (!settings.defaultOutputFolder) {
      throw new Error('Choose an output folder in Settings before processing files.')
    }
    const outputDetails = await stat(settings.defaultOutputFolder)
    if (!outputDetails.isDirectory()) {
      throw new Error('The configured output path is not a folder.')
    }

    const selection = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Choose files to process',
      filters: [{
        name: `${payload.inputType.toUpperCase()} files`,
        extensions: extensionsForFormats(formats),
      }],
    })
    if (selection.canceled) return null
    return queueFilePaths(selection.filePaths, settings.defaultOutputFolder, options, jobQueue)
  })

  ipcMain.handle('files:queue-dropped', async (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const payload = args[0]
    if (
      !isPlainRecord(payload) ||
      Object.keys(payload).length !== 3 ||
      !Array.isArray(payload.paths) ||
      payload.paths.length < 1 ||
      payload.paths.length > 500 ||
      payload.paths.some((path) => typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) ||
      typeof payload.inputType !== 'string' ||
      !isPlainRecord(payload.options)
    ) {
      throw new TypeError('Dropped file request is invalid.')
    }
    const { processor } = resolveProcessingInput(payload.inputType, processorRegistry)
    const options = validateProcessingOptions(payload.options, payload.inputType, processor)
    const outputFolder = settingsRepository.get().defaultOutputFolder
    if (!outputFolder) {
      throw new Error('Choose an output folder in Settings before processing files.')
    }
    const outputDetails = await stat(outputFolder)
    if (!outputDetails.isDirectory()) throw new Error('The configured output path is not a folder.')
    return queueFilePaths(payload.paths, outputFolder, options, jobQueue)
  })

  ipcMain.handle('folders:list', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return folderRepository.list()
  })

  ipcMain.handle('folders:add', async (event, ...args) => {
    const mainWindow = assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Choose a folder to monitor',
    })
    if (result.canceled) return null
    return watcherService.addFolder(result.filePaths[0])
  })

  ipcMain.handle('folders:set-enabled', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const payload = args[0]
    if (!isPlainRecord(payload) || Object.keys(payload).length !== 2) {
      throw new TypeError('Folder update payload is invalid.')
    }
    return watcherService.setFolderEnabled(
      validateFolderId(payload.id),
      validateEnabled(payload.enabled),
    )
  })

  ipcMain.handle('folders:remove', async (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    await watcherService.removeFolder(validateFolderId(args[0]))
    return true
  })

  ipcMain.handle('automation:list', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    return ruleRepository.list()
  })

  ipcMain.handle('automation:save', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    return ruleRepository.save(validateRule(args[0]))
  })

  ipcMain.handle('automation:delete', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    ruleRepository.remove(validateFolderId(args[0]))
    return true
  })

  ipcMain.handle('monitoring:pause', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    watcherService.pause()
    return { running: watcherService.isRunning, paused: watcherService.isPaused }
  })

  ipcMain.handle('monitoring:resume', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 0)
    watcherService.resume()
    return { running: watcherService.isRunning, paused: watcherService.isPaused }
  })

  ipcMain.handle('history:list', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    if (args.length > 1) throw new TypeError('History request accepts at most one argument.')
    const limit = args[0] ?? 100
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError('History limit must be from 1 to 1000.')
    }
    return jobRepository.listHistory(limit)
  })

  ipcMain.handle('history:open-output-location', async (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const historyId = validateUuid(args[0], 'History record ID')
    const outputPath = jobRepository.getHistoryOutputPath(historyId)
    if (!outputPath) throw new Error('This history record has no completed output file.')
    const details = await lstat(outputPath)
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error('The output file is not available.')
    }
    shell.showItemInFolder(outputPath)
    return true
  })

  ipcMain.handle('jobs:cancel', (event, ...args) => {
    assertTrustedSender(event, getMainWindow())
    assertArgumentCount(args, 1)
    const id = validateUuid(args[0], 'Processing job ID')
    return jobQueue.cancel(id)
  })
}

function resolveProcessingInput(inputType, processorRegistry) {
  const processor = inputType === 'image'
    ? processorRegistry.get('image')
    : processorRegistry.forInput(inputType)
  if (!processor) throw new TypeError('The selected input format is not supported.')
  const formats = inputType === 'image' ? processor.inputFormats : [inputType]
  if (formats.some((format) => !processor.supportsInput(format))) {
    throw new TypeError('The selected input format is not supported.')
  }
  return { processor, formats }
}

function validateProcessingOptions(options, inputType, processor) {
  if (!isPlainRecord(options) || typeof options.outputFormat !== 'string') {
    throw new TypeError('File processing options are invalid.')
  }
  if (processor.id === 'image') {
    if (
      Object.keys(options).some((key) => !['outputFormat', 'quality', 'resize'].includes(key)) ||
      !processor.supportsOutput(options.outputFormat)
    ) {
      throw new TypeError('Image conversion options are invalid.')
    }
    return validateRule({
      name: 'Manual image conversion',
      match: { inputFormat: 'png' },
      action: options,
    }).action
  }
  if (
    Object.keys(options).length !== 1 ||
    !processor.supportsOutput(options.outputFormat) ||
    (processor.supportsConversion && !processor.supportsConversion(inputType, options.outputFormat))
  ) {
    throw new TypeError('The selected processor does not support these options.')
  }
  return { outputFormat: options.outputFormat }
}

function extensionsForFormats(formats) {
  const extensions = {
    jpeg: ['jpg', 'jpeg'],
    tiff: ['tif', 'tiff'],
  }
  return [...new Set(formats.flatMap((format) => extensions[format] ?? [format]))]
}

async function queueFilePaths(sourcePaths, outputFolder, options, jobQueue) {
  const result = { queued: 0, duplicates: 0, failed: [] }
  for (const sourcePath of sourcePaths) {
    try {
      const job = await jobQueue.enqueue({ sourcePath, outputFolder, options })
      if (job.duplicate) result.duplicates += 1
      else result.queued += 1
    } catch (error) {
      console.error(`AutoCompress could not queue "${basename(sourcePath)}":`, error)
      result.failed.push({
        file: basename(sourcePath),
        message: error instanceof Error ? error.message : 'The file could not be queued.',
      })
    }
  }
  return result
}

function validateUuid(value, label) {
  if (typeof value !== 'string' || !/^[\da-f-]{36}$/i.test(value)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return value
}

function assertArgumentCount(args, expected) {
  if (args.length !== expected) {
    throw new TypeError(`IPC request requires exactly ${expected} argument(s).`)
  }
}

function assertTrustedSender(event, mainWindow) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('IPC request rejected: untrusted sender.')
  }
  const url = event.senderFrame?.url ?? ''
  const isDev = process.env.VITE_DEV_SERVER_URL
  const trusted = isDev
    ? url.startsWith('http://127.0.0.1:5173/')
    : url.startsWith('file://')
  if (!trusted) throw new Error('IPC request rejected: untrusted frame.')
  return mainWindow
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
