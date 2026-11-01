import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db/database.js'
import { createSettingsRepository } from './db/settings-repository.js'
import { registerIpcHandlers } from './ipc/register-handlers.js'
import { createJobRepository } from './processing/job-repository.js'
import { JobQueue } from './processing/job-queue.js'
import { ProcessorRegistry } from './processing/processor-registry.js'
import { createFolderRepository, createRuleRepository } from './automation/repositories.js'
import { WatcherService } from './automation/watcher-service.js'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
if (process.env.AUTOCOMPRESS_TEST_USER_DATA) {
  app.setPath('userData', resolve(process.env.AUTOCOMPRESS_TEST_USER_DATA))
}
let database
let settingsRepository
let jobQueue
let watcherService
let mainWindow
let tray
let isQuitting = false
let shutdownStarted = false
const hasSingleInstance = app.requestSingleInstanceLock()

if (!hasSingleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  app.whenReady().then(startApplication).catch((error) => {
    console.error('AutoCompress failed to start:', error)
    app.quit()
  })
}

app.on('before-quit', (event) => {
  isQuitting = true
  if (!jobQueue || shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  const stopMonitoring = watcherService?.stop() ?? Promise.resolve()
  stopMonitoring.then(() => jobQueue.close()).then(
    () => app.quit(),
    (error) => {
      console.error('AutoCompress could not finish queue shutdown:', error)
      database?.close()
      database = null
      app.exit(1)
    },
  )
})

app.on('will-quit', () => {
  database?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function startApplication() {
  database = openDatabase(join(app.getPath('userData'), 'autocompress.sqlite'))
  settingsRepository = createSettingsRepository(database)
  const jobRepository = createJobRepository(database)
  const folderRepository = createFolderRepository(database)
  const ruleRepository = createRuleRepository(database)
  jobRepository.recoverInterrupted()
  const processorRegistry = new ProcessorRegistry()
  jobQueue = new JobQueue({
    database: jobRepository,
    registry: processorRegistry,
    concurrency: settingsRepository.get().maxConcurrency,
  })
  watcherService = new WatcherService({
    folderRepository,
    ruleRepository,
    jobQueue,
    getOutputFolder: () => settingsRepository.get().defaultOutputFolder,
    concurrency: settingsRepository.get().maxConcurrency,
  })
  jobQueue.on('job-updated', (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('jobs:updated', update)
    }
    if (
      settingsRepository.get().notifications &&
      Notification.isSupported() &&
      ['completed', 'failed'].includes(update.status)
    ) {
      try {
        const notification = new Notification({
          title: 'AutoCompress',
          body: update.status === 'completed'
            ? 'Image processing completed.'
            : 'An image could not be processed.',
        })
        notification.on('click', showMainWindow)
        notification.show()
      } catch (error) {
        console.error('AutoCompress could not show a processing notification:', error)
      }
    }
  })
  watcherService.on('status-changed', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('monitoring:status', status)
    }
  })
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsRepository,
    getStatus: () => ({
      version: app.getVersion(),
      platform: process.platform,
      trayAvailable: Boolean(tray),
      monitoring: watcherService.isRunning && !watcherService.isPaused,
      paused: watcherService.isPaused,
    }),
    setLaunchAtStartup: (enabled) => {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: app.isPackaged ? [] : [app.getAppPath()],
      })
    },
    setJobConcurrency: (concurrency) => {
      jobQueue.setConcurrency(concurrency)
      watcherService.setConcurrency(concurrency)
    },
    folderRepository,
    ruleRepository,
    watcherService,
    jobRepository,
    jobQueue,
    processorRegistry,
    quit: () => app.quit(),
  })

  createTray()
  createMainWindow()
  await watcherService.start()
  if (settingsRepository.get().launchAtStartup) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    })
  }
  app.on('activate', showMainWindow)
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const trusted = process.env.VITE_DEV_SERVER_URL
      ? navigationUrl.startsWith('http://127.0.0.1:5173/')
      : navigationUrl.startsWith('file://')
    if (!trusted) event.preventDefault()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && settingsRepository.get().minimizeToTray) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    installDevelopmentCsp()
  } else {
    mainWindow.loadFile(join(currentDirectory, '..', '..', 'dist', 'renderer', 'index.html'))
    installProductionCsp()
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(join(currentDirectory, 'assets', 'tray.png'))
  if (icon.isEmpty()) throw new Error('The system tray icon could not be loaded.')
  tray = new Tray(icon)
  tray.setToolTip('AutoCompress')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open AutoCompress', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('double-click', showMainWindow)
}

function installDevelopmentCsp() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ')
  installCsp(policy)
}

function installProductionCsp() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ')
  installCsp(policy)
}

function installCsp(policy) {
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
