const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('autoCompress', Object.freeze({
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  selectOutputFolder: () => ipcRenderer.invoke('settings:select-output-folder'),
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  getDashboardSummary: () => ipcRenderer.invoke('dashboard:get-summary'),
  getProcessorCapabilities: () => ipcRenderer.invoke('processors:list-capabilities'),
  openOutputFolder: () => ipcRenderer.invoke('app:open-output-folder'),
  selectFilesForProcessing: (inputType, options) =>
    ipcRenderer.invoke('files:select-and-queue', { inputType, options }),
  processDroppedFiles: (files, inputType, options) => {
    if (!Array.isArray(files) || files.length === 0) {
      throw new TypeError('At least one dropped file is required.')
    }
    const paths = files.map((file) => webUtils.getPathForFile(file))
    return ipcRenderer.invoke('files:queue-dropped', { paths, inputType, options })
  },
  listWatchedFolders: () => ipcRenderer.invoke('folders:list'),
  addWatchedFolder: () => ipcRenderer.invoke('folders:add'),
  setWatchedFolderEnabled: (id, enabled) =>
    ipcRenderer.invoke('folders:set-enabled', { id, enabled }),
  removeWatchedFolder: (id) => ipcRenderer.invoke('folders:remove', id),
  listAutomationRules: () => ipcRenderer.invoke('automation:list'),
  saveAutomationRule: (rule) => ipcRenderer.invoke('automation:save', rule),
  deleteAutomationRule: (id) => ipcRenderer.invoke('automation:delete', id),
  pauseMonitoring: () => ipcRenderer.invoke('monitoring:pause'),
  resumeMonitoring: () => ipcRenderer.invoke('monitoring:resume'),
  getHistory: (limit) => ipcRenderer.invoke('history:list', limit),
  openHistoryOutputLocation: (id) => ipcRenderer.invoke('history:open-output-location', id),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  onJobUpdated: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Job update callback is required.')
    const listener = (_event, update) => callback(update)
    ipcRenderer.on('jobs:updated', listener)
    return () => ipcRenderer.removeListener('jobs:updated', listener)
  },
  onMonitoringStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Monitoring callback is required.')
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('monitoring:status', listener)
    return () => ipcRenderer.removeListener('monitoring:status', listener)
  },
  quit: () => ipcRenderer.invoke('app:quit'),
}))
