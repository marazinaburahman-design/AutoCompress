import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileCheck2,
  FileImage,
  FileX2,
  FolderOpen,
  HardDrive,
  Gauge,
  ImagePlus,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { create } from 'zustand'
import './styles.css'

const useAppStore = create((set, get) => ({
  settings: null,
  status: null,
  summary: null,
  capabilities: [],
  folders: [],
  rules: [],
  history: [],
  jobs: [],
  loading: true,
  error: null,
  notice: null,
  busy: false,
  async initialize() {
    try {
      const [settings, status, summary, capabilities, folders, rules, history] = await Promise.all([
        window.autoCompress.getSettings(),
        window.autoCompress.getStatus(),
        window.autoCompress.getDashboardSummary(),
        window.autoCompress.getProcessorCapabilities(),
        window.autoCompress.listWatchedFolders(),
        window.autoCompress.listAutomationRules(),
        window.autoCompress.getHistory(100),
      ])
      set({ settings, status, summary, capabilities, folders, rules, history, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },
  async refreshHistory() {
    const history = await window.autoCompress.getHistory(100)
    set({ history })
  },
  async refreshDashboardSummary() {
    const summary = await window.autoCompress.getDashboardSummary()
    set({ summary })
  },
  setSettings(settings) {
    set({ settings })
  },
  setFolders(folders) {
    set({ folders })
  },
  setRules(rules) {
    set({ rules })
  },
  setStatus(status) {
    set({ status: { ...get().status, ...status } })
  },
  addJobUpdate(update) {
    set((state) => ({
      jobs: [update, ...state.jobs.filter((job) => job.id !== update.id)].slice(0, 8),
    }))
    get().refreshDashboardSummary().catch((error) => set({ error: error.message }))
    if (['completed', 'failed', 'cancelled'].includes(update.status)) {
      get().refreshHistory().catch((error) => set({ error: error.message }))
    }
  },
  setError(error) {
    set({ error, notice: null })
  },
  setNotice(notice) {
    set({ error: null, notice })
  },
  clearMessages() {
    set({ error: null, notice: null })
  },
  setBusy(busy) {
    set({ busy })
  },
}))

async function performAction(operation, successMessage) {
  const store = useAppStore.getState()
  store.clearMessages()
  store.setBusy(true)
  try {
    const result = await operation()
    if (successMessage) useAppStore.getState().setNotice(successMessage)
    return result
  } catch (error) {
    useAppStore.getState().setError(error.message)
    return undefined
  } finally {
    useAppStore.getState().setBusy(false)
  }
}

function App() {
  const {
    settings, status, summary, capabilities, folders, rules, history, jobs, loading, error, notice, busy,
    initialize, setSettings, setFolders, setRules, setStatus, addJobUpdate, refreshHistory, refreshDashboardSummary,
  } = useAppStore()
  const [page, setPage] = React.useState('overview')

  React.useEffect(() => {
    initialize()
    const removeJobListener = window.autoCompress.onJobUpdated(addJobUpdate)
    const removeStatusListener = window.autoCompress.onMonitoringStatus(setStatus)
    return () => {
      removeJobListener()
      removeStatusListener()
    }
  }, [initialize, addJobUpdate, setStatus])

  React.useEffect(() => {
    if (!settings) return undefined
    const preference = settings.theme
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        preference === 'system' ? (media.matches ? 'light' : 'dark') : preference
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings?.theme])

  if (loading) {
    return <main className="loading-screen"><span className="loading-mark">A</span><p>Starting AutoCompress…</p></main>
  }

  const pageTitles = {
    overview: 'Dashboard',
    processing: 'File Processing',
    folders: 'Watched folders',
    automation: 'Automation',
    history: 'Processing history',
    formats: 'Supported Formats',
    settings: 'Settings',
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>AutoCompress<small>LOCAL FILE AUTOMATION</small></span></div>
        <div className="nav-label">WORKSPACE</div>
        <NavigationItem active={page === 'overview'} icon={Activity} onClick={() => setPage('overview')}>Dashboard</NavigationItem>
        <NavigationItem active={page === 'processing'} icon={ImagePlus} onClick={() => setPage('processing')}>File Processing</NavigationItem>
        <NavigationItem active={page === 'folders'} icon={FolderOpen} onClick={() => setPage('folders')}>Watched folders</NavigationItem>
        <NavigationItem active={page === 'automation'} icon={Gauge} onClick={() => setPage('automation')}>Automation</NavigationItem>
        <NavigationItem active={page === 'history'} icon={Archive} onClick={() => setPage('history')}>History</NavigationItem>
        <NavigationItem active={page === 'formats'} icon={FileCheck2} onClick={() => setPage('formats')}>Supported Formats</NavigationItem>
        <div className="nav-label nav-label-secondary">PREFERENCES</div>
        <NavigationItem active={page === 'settings'} icon={Settings2} onClick={() => setPage('settings')}>Settings</NavigationItem>
        <div className="sidebar-footer"><ShieldCheck size={16} /><span>Files stay on this device</span></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">YOUR WORKSPACE</span><h1>{pageTitles[page]}</h1></div>
          <div className="topbar-actions">
            <div className={`status-pill ${status?.paused ? 'is-paused' : ''}`}>
              <span className="status-dot" />{status?.paused ? 'Monitoring paused' : status?.monitoring ? 'Monitoring active' : 'Ready'}
            </div>
            {page !== 'settings' && (status?.monitoring || status?.paused) && (
              <button
                className="button button-subtle button-small"
                onClick={() => performAction(async () => {
                  const next = status?.paused
                    ? await window.autoCompress.resumeMonitoring()
                    : await window.autoCompress.pauseMonitoring()
                  setStatus(next)
                }, status?.paused ? 'Monitoring resumed.' : 'Monitoring paused.')}
                disabled={busy || (!status?.monitoring && !status?.paused)}
                aria-label={status?.paused ? 'Resume monitoring' : 'Pause monitoring'}
              >
                {status?.paused ? <Play size={14} /> : <Activity size={14} />}
                {status?.paused ? 'Resume' : 'Pause'}
              </button>
            )}
          </div>
        </header>

        {error && <div className="message-banner error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
        {notice && <div className="message-banner notice-banner" role="status"><CircleCheck size={16} />{notice}</div>}

        {page === 'overview' && <OverviewPage
          status={status} summary={summary} folders={folders} history={history} jobs={jobs}
          busy={busy} onNavigate={setPage}
        />}
        {page === 'processing' && <FileProcessingPage
          settings={settings} capabilities={capabilities} jobs={jobs} history={history} busy={busy}
          onHistoryRefresh={refreshHistory} onSummaryRefresh={refreshDashboardSummary}
        />}
        {page === 'folders' && <FoldersPage folders={folders} busy={busy} onFoldersChange={setFolders} />}
        {page === 'automation' && <AutomationPage rules={rules} busy={busy} onRulesChange={setRules} />}
        {page === 'history' && <HistoryPage history={history} busy={busy} onRefresh={refreshHistory} />}
        {page === 'formats' && <SupportedFormatsPage capabilities={capabilities} />}
        {page === 'settings' && <SettingsPage settings={settings} status={status} busy={busy} onSettingsChange={setSettings} />}

        <footer className="app-footer"><span>AutoCompress {status?.version} · {status?.platform}</span><span>Local-first by design <ChevronRight size={13} /></span></footer>
      </main>
    </div>
  )
}

function NavigationItem({ active, icon: Icon, onClick, children }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}><Icon size={17} />{children}</button>
}

function OverviewPage({ status, summary, folders, history, jobs, busy, onNavigate }) {
  async function cancelJob(job) {
    const cancelled = await performAction(() => window.autoCompress.cancelJob(job.id), null)
    if (cancelled) useAppStore.getState().setNotice('Cancellation requested.')
    else if (cancelled === false) useAppStore.getState().setNotice('That job is no longer active.')
  }
  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(job.status))
  const currentJobs = activeJobs.length ? activeJobs : summary?.currentJobs ?? []

  return (
    <>
      <section className="welcome-card">
        <div className="welcome-content">
          <span className="eyebrow accent">PRIVATE, LOCAL IMAGE PROCESSING</span>
          <h2>Your files, processed on this device.</h2>
          <p>Monitor automated workflows, convert selected images, and review results. Source files are preserved.</p>
          <button className="button button-primary dashboard-cta" onClick={() => onNavigate('processing')} disabled={busy}><ImagePlus size={16} /> Process images <ArrowRight size={14} /></button>
        </div>
        <div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-core"><ShieldCheck size={46} strokeWidth={1.4} /></div><div className="art-chip chip-one"><FolderOpen size={17} /></div><div className="art-chip chip-two"><Check size={17} /></div></div>
      </section>

      <div className="stats-grid dashboard-stats">
        <StatCard icon={Activity} label="Monitoring status" value={status?.paused ? 'Paused' : status?.monitoring ? 'Active' : 'Idle'} detail={`${folders.filter((folder) => folder.enabled).length} folders enabled`} onClick={() => onNavigate('folders')} />
        <StatCard icon={FileImage} label="Files processed" value={summary?.processedFiles ?? 0} detail="Completed or failed" onClick={() => onNavigate('history')} />
        <StatCard icon={HardDrive} label="Space saved" value={formatBytes(Math.abs(summary?.spaceSaved ?? 0))} detail={(summary?.spaceSaved ?? 0) < 0 ? 'Net increase in output size' : 'Across successful jobs'} onClick={() => onNavigate('history')} />
        <StatCard icon={FileCheck2} label="Successful jobs" value={summary?.successfulJobs ?? 0} detail="Completed conversions" onClick={() => onNavigate('history')} />
        <StatCard icon={FileX2} label="Failed jobs" value={summary?.failedJobs ?? 0} detail="Review errors in history" onClick={() => onNavigate('history')} />
        <StatCard icon={Clock3} label="Current jobs" value={currentJobs.length} detail="Queued or processing" onClick={() => onNavigate('processing')} />
      </div>

      <section className="content-section">
        <div className="section-heading"><div><span className="eyebrow">LIVE QUEUE</span><h2>Current jobs</h2></div><button className="text-button" onClick={() => onNavigate('processing')}>Open processing <ArrowRight size={14} /></button></div>
        {currentJobs.length > 0 ? <div className="activity-list">{currentJobs.map((job) => <ActivityRow key={job.id} job={job} busy={busy} onCancel={() => cancelJob(job)} />)}</div> : <EmptyState icon={Clock3} title="Nothing processing right now" description="New manual and automated jobs will appear here." />}
      </section>

      <section className="content-section">
        <div className="section-heading"><div><span className="eyebrow">AUTOMATION INPUTS</span><h2>Monitored folders</h2></div><button className="text-button" onClick={() => onNavigate('folders')}>Manage folders <ArrowRight size={14} /></button></div>
        {folders.length ? <div className="folder-summary-list">{folders.map((folder) => <div className="folder-summary-row" key={folder.id}><FolderOpen size={16} /><span title={folder.path}>{folder.path}</span><span className={`state-label ${folder.enabled ? 'state-on' : 'state-off'}`}>{folder.enabled ? 'Enabled' : 'Paused'}</span></div>)}</div> : <EmptyState icon={FolderOpen} title="No folders are being monitored" description="Add a folder to automate processing of new images." action={<button className="button button-subtle" onClick={() => onNavigate('folders')}>Set up folders</button>} />}
      </section>

      <section className="content-section recent-history">
        <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest results</h2></div><button className="text-button" onClick={() => onNavigate('history')}>All history <ArrowRight size={14} /></button></div>
        {history.length ? <div className="activity-list">{history.slice(0, 4).map((item) => <HistoryRow key={item.id} item={item} />)}</div> : <EmptyState icon={FileImage} title="Your history is empty" description="Completed, failed, and cancelled jobs are recorded here." />}
      </section>
    </>
  )
}

function StatCard({ icon: Icon, label, value, detail, onClick }) {
  return <button className="stat-card" onClick={onClick}><span className="stat-icon"><Icon size={17} /></span><span className="stat-copy"><small>{label}</small><strong>{value}</strong><span>{detail}</span></span><ChevronRight className="stat-arrow" size={15} /></button>
}

function FileProcessingPage({ settings, capabilities, jobs, history, busy, onHistoryRefresh, onSummaryRefresh }) {
  const [inputType, setInputType] = React.useState('image')
  const [outputFormat, setOutputFormat] = React.useState('webp')
  const [quality, setQuality] = React.useState(settings?.defaultQuality ?? 80)
  const [resizeEnabled, setResizeEnabled] = React.useState(false)
  const [width, setWidth] = React.useState('')
  const [height, setHeight] = React.useState('')
  const [isDragging, setIsDragging] = React.useState(false)
  const [queueSummary, setQueueSummary] = React.useState(null)

  React.useEffect(() => {
    setQuality(settings?.defaultQuality ?? 80)
  }, [settings?.defaultQuality])

  const processingTypes = getProcessingTypes(capabilities)
  const selectedType = processingTypes.find((type) => type.value === inputType) ?? processingTypes[0]
  const isImageProcessing = selectedType?.processorId === 'image'

  React.useEffect(() => {
    if (!selectedType) return
    const defaultFormat = selectedType.value === 'image'
      ? 'webp'
      : selectedType.outputFormats[0]
    if (!selectedType.outputFormats.includes(outputFormat)) setOutputFormat(defaultFormat)
  }, [inputType, outputFormat, selectedType])

  function getOptions() {
    if (!isImageProcessing) return { outputFormat }
    const resize = resizeEnabled
      ? Object.fromEntries([['width', width], ['height', height]].filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)]))
      : null
    return {
      outputFormat,
      quality,
      resize: resize && Object.keys(resize).length ? resize : null,
    }
  }

  async function submitFiles(operation) {
    const result = await performAction(operation, null)
    if (!result) return
    const message = `${result.queued} queued · ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped${result.failed.length ? ` · ${result.failed.length} failed` : ''}.`
    setQueueSummary({ ...result, message })
    if (result.failed.length) {
      useAppStore.getState().setError(`${message} ${result.failed.map((item) => `${item.file}: ${item.message}`).join(' ')}`)
    } else {
      useAppStore.getState().setNotice(message)
    }
    Promise.all([onHistoryRefresh(), onSummaryRefresh()])
      .catch((error) => useAppStore.getState().setError(error.message))
  }

  function chooseFiles() {
    return submitFiles(() => window.autoCompress.selectFilesForProcessing(inputType, getOptions()))
  }

  function processDropped(files) {
    const selectedFiles = Array.from(files ?? [])
    if (!selectedFiles.length) return
    return submitFiles(() => window.autoCompress.processDroppedFiles(selectedFiles, inputType, getOptions()))
  }

  function onDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    processDropped(event.dataTransfer.files)
  }

  async function cancelJob(job) {
    const cancelled = await performAction(() => window.autoCompress.cancelJob(job.id), null)
    if (cancelled) useAppStore.getState().setNotice('Cancellation requested.')
    else if (cancelled === false) useAppStore.getState().setNotice('That job is no longer active.')
  }

  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(job.status))
  const recentResults = history.slice(0, 4)
  const acceptedExtensions = selectedType?.inputFormats
    .map((format) => formatLabel(format))
    .join(', ') ?? 'None'

  return (
    <>
      <PageIntro eyebrow="ONE-TIME PROCESSING" title="Process files" description="Select multiple files or drop them here. The original files stay untouched; processed copies go to your configured output folder." />
      {!settings?.defaultOutputFolder && <div className="message-banner error-banner"><CircleAlert size={16} /><span>Choose an output folder in Settings before processing.</span></div>}
      {processingTypes.length > 0 && <section className="processing-config">
        <div className="config-grid">
          <label className="form-field"><span>File type</span><select aria-label="Processing input type" value={inputType} disabled={busy} onChange={(event) => {
            setInputType(event.target.value)
            const nextType = processingTypes.find((type) => type.value === event.target.value)
            setOutputFormat(event.target.value === 'image'
              ? 'webp'
              : nextType?.outputFormats[0] ?? '')
          }}>{processingTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        </div>
      </section>}
      <div
        className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false)
        }}
        onDrop={onDrop}
        aria-label={`Drop ${selectedType?.label ?? 'files'} to process`}
      >
        <span className="drop-icon"><ImagePlus size={24} /></span>
        <h2>Drop {selectedType?.label.toLowerCase() ?? 'files'} here</h2>
        <p>Multiple files supported · {acceptedExtensions}</p>
        <button className="button button-subtle" onClick={chooseFiles} disabled={busy || !settings?.defaultOutputFolder || !selectedType}>Choose files</button>
      </div>

      <section className="processing-config">
        <div className="section-heading"><div><span className="eyebrow">OUTPUT CONFIGURATION</span><h2>Processing settings</h2></div></div>
        <div className="config-grid">
          <label className="form-field"><span>Output format</span><select aria-label="Processing output format" value={outputFormat} disabled={busy} onChange={(event) => setOutputFormat(event.target.value)}>{(selectedType?.outputFormats ?? []).map((format) => <option key={format} value={format}>{formatLabel(format)}</option>)}</select></label>
          {isImageProcessing && <>
            <label className="form-field"><span>Quality <strong>{quality}%</strong></span><input aria-label="Processing quality" type="range" min="1" max="100" value={quality} disabled={busy} onChange={(event) => setQuality(Number(event.target.value))} /></label>
            <label className="form-field resize-choice"><input type="checkbox" checked={resizeEnabled} disabled={busy} onChange={(event) => setResizeEnabled(event.target.checked)} /><span>Resize output</span></label>
          </>}
          {isImageProcessing && resizeEnabled && <>
            <label className="form-field"><span>Maximum width (px)</span><input aria-label="Processing maximum width" type="number" min="1" max="32768" value={width} disabled={busy} onChange={(event) => setWidth(event.target.value)} placeholder="Keep original" /></label>
            <label className="form-field"><span>Maximum height (px)</span><input aria-label="Processing maximum height" type="number" min="1" max="32768" value={height} disabled={busy} onChange={(event) => setHeight(event.target.value)} placeholder="Keep original" /></label>
          </>}
        </div>
      </section>

      {queueSummary && <div className="info-strip" role="status"><CircleCheck size={16} /><span>{queueSummary.message}</span></div>}
      <section className="content-section">
        <div className="section-heading"><div><span className="eyebrow">LIVE QUEUE</span><h2>Progress</h2></div></div>
        {activeJobs.length ? <div className="activity-list">{activeJobs.map((job) => <ActivityRow key={job.id} job={job} busy={busy} onCancel={() => cancelJob(job)} />)}</div> : <EmptyState icon={Clock3} title="No active jobs" description="Queued and processing images will appear here." />}
      </section>
      <section className="content-section">
        <div className="section-heading"><div><span className="eyebrow">RESULTS</span><h2>Recent results</h2></div></div>
        {recentResults.length ? <div className="activity-list">{recentResults.map((item) => <HistoryRow key={item.id} item={item} />)}</div> : <EmptyState icon={FileImage} title="No results yet" description="Processed files and their outcomes will appear here." />}
      </section>
    </>
  )
}

function FoldersPage({ folders, busy, onFoldersChange }) {
  async function addFolder() {
    const updatedFolders = await performAction(async () => {
      const folder = await window.autoCompress.addWatchedFolder()
      return folder ? window.autoCompress.listWatchedFolders() : null
    }, null)
    if (updatedFolders) {
      onFoldersChange(updatedFolders)
      useAppStore.getState().setNotice('Folder added and monitoring is enabled.')
    }
  }
  async function toggleFolder(folder) {
    const updated = await performAction(
      () => window.autoCompress.setWatchedFolderEnabled(folder.id, !folder.enabled),
      folder.enabled ? 'Folder monitoring disabled.' : 'Folder monitoring enabled.',
    )
    if (updated) onFoldersChange(folders.map((item) => item.id === updated.id ? updated : item))
  }
  async function removeFolder(folder) {
    if (!window.confirm(`Stop monitoring and remove "${folder.path}"? Existing files will not be deleted.`)) return
    const removed = await performAction(() => window.autoCompress.removeWatchedFolder(folder.id), 'Watched folder removed.')
    if (removed !== undefined) onFoldersChange(folders.filter((item) => item.id !== folder.id))
  }

  return (
    <>
      <PageIntro eyebrow="AUTOMATION INPUTS" title="Choose folders to watch" description="New supported images in enabled folders are checked against your rules and processed automatically. Existing files are not scanned." action={<button className="button button-primary" onClick={addFolder} disabled={busy}><Plus size={16} /> Add folder</button>} />
      <div className="info-strip"><ShieldCheck size={16} /><span>Only new files are processed. Symlinks and temporary or incomplete copies are ignored.</span></div>
      {folders.length ? <div className="folder-list">{folders.map((folder) => (
        <article className="folder-card" key={folder.id}>
          <div className={`folder-icon ${folder.enabled ? 'enabled' : ''}`}><FolderOpen size={19} /></div>
          <div className="folder-details"><h3 title={folder.path}>{folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path}</h3><p title={folder.path}>{folder.path}</p><span className={`state-label ${folder.enabled ? 'state-on' : 'state-off'}`}>{folder.enabled ? 'Monitoring enabled' : 'Paused'}</span></div>
          <div className="card-actions">
            <Toggle label={folder.enabled ? 'Pause folder' : 'Enable folder'} checked={folder.enabled} onChange={() => toggleFolder(folder)} disabled={busy} />
            <button className="icon-button danger-hover" onClick={() => removeFolder(folder)} disabled={busy} aria-label={`Remove ${folder.path}`} title="Remove folder"><Trash2 size={16} /></button>
          </div>
        </article>
      ))}</div> : <EmptyState icon={FolderOpen} title="No folders are being monitored" description="Add a folder to start processing new images automatically." action={<button className="button button-primary" onClick={addFolder} disabled={busy}><Plus size={16} /> Add your first folder</button>} />}
    </>
  )
}

function AutomationPage({ rules, busy, onRulesChange }) {
  const [editingRule, setEditingRule] = React.useState(null)
  const [creating, setCreating] = React.useState(false)

  async function saveRule(rule) {
    const saved = await performAction(() => window.autoCompress.saveAutomationRule(rule), rule.id ? 'Automation rule updated.' : 'Automation rule created.')
    if (!saved) return
    const next = rules.some((item) => item.id === saved.id)
      ? rules.map((item) => item.id === saved.id ? saved : item)
      : [...rules, saved]
    onRulesChange(next.sort((a, b) => b.priority - a.priority))
    setEditingRule(null)
    setCreating(false)
  }
  async function toggleRule(rule) {
    const saved = await performAction(() => window.autoCompress.saveAutomationRule({
      id: rule.id,
      name: rule.name,
      enabled: !rule.enabled,
      priority: rule.priority,
      match: rule.match,
      action: rule.action,
    }), rule.enabled ? 'Rule disabled.' : 'Rule enabled.')
    if (saved) onRulesChange(rules.map((item) => item.id === saved.id ? saved : item))
  }
  async function deleteRule(rule) {
    if (!window.confirm(`Delete the "${rule.name}" rule?`)) return
    const removed = await performAction(() => window.autoCompress.deleteAutomationRule(rule.id), 'Automation rule deleted.')
    if (removed !== undefined) onRulesChange(rules.filter((item) => item.id !== rule.id))
  }

  return (
    <>
      <PageIntro eyebrow="IMAGE WORKFLOWS" title="Create rules for new images" description="Rules are applied to all enabled watched folders. When multiple rules match an input format, the highest-priority enabled rule is used." action={<button className="button button-primary" onClick={() => { setEditingRule(null); setCreating(true) }} disabled={busy}><Plus size={16} /> New rule</button>} />
      {creating && <RuleEditor onCancel={() => setCreating(false)} onSave={saveRule} busy={busy} />}
      {editingRule && <RuleEditor key={editingRule.id} initial={editingRule} onCancel={() => setEditingRule(null)} onSave={saveRule} busy={busy} />}
      {rules.length ? <div className="rule-list">{rules.map((rule) => (
        <article className={`rule-card ${rule.enabled ? '' : 'is-disabled'}`} key={rule.id}>
          <div className="rule-priority"><small>PRIORITY</small><strong>{rule.priority}</strong></div>
          <div className="rule-details"><div className="rule-title-row"><h3>{rule.name}</h3><span className={`state-label ${rule.enabled ? 'state-on' : 'state-off'}`}>{rule.enabled ? 'Enabled' : 'Disabled'}</span></div><p>When an image is <strong>{formatLabel(rule.match.inputFormat)}</strong>, convert it to <strong>{formatLabel(rule.action.outputFormat)}</strong> at {rule.action.quality}% quality{rule.action.resize ? ` · resize to ${rule.action.resize.width || 'auto'} × ${rule.action.resize.height || 'auto'}` : ''}.</p></div>
          <div className="card-actions"><Toggle label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`} checked={rule.enabled} onChange={() => toggleRule(rule)} disabled={busy} /><button className="icon-button" onClick={() => { setCreating(false); setEditingRule(rule) }} disabled={busy} aria-label={`Edit ${rule.name}`} title="Edit rule"><Pencil size={15} /></button><button className="icon-button danger-hover" onClick={() => deleteRule(rule)} disabled={busy} aria-label={`Delete ${rule.name}`} title="Delete rule"><Trash2 size={15} /></button></div>
        </article>
      ))}</div> : !creating && <EmptyState icon={Gauge} title="No automation rules yet" description="Create a rule to choose how new images should be converted." action={<button className="button button-primary" onClick={() => setCreating(true)} disabled={busy}><Plus size={16} /> Create a rule</button>} />}
      <div className="info-strip"><CircleAlert size={16} /><span>Input formats are identified from file contents, not filenames. Unsupported or corrupt files are recorded as failed jobs.</span></div>
    </>
  )
}

function RuleEditor({ initial, onCancel, onSave, busy }) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [inputFormat, setInputFormat] = React.useState(initial?.match.inputFormat ?? 'jpeg')
  const [outputFormat, setOutputFormat] = React.useState(initial?.action.outputFormat ?? 'webp')
  const [quality, setQuality] = React.useState(initial?.action.quality ?? 80)
  const [priority, setPriority] = React.useState(initial?.priority ?? 0)
  const [enabled, setEnabled] = React.useState(initial?.enabled ?? true)
  const [resizeEnabled, setResizeEnabled] = React.useState(Boolean(initial?.action.resize))
  const [width, setWidth] = React.useState(initial?.action.resize?.width?.toString() ?? '')
  const [height, setHeight] = React.useState(initial?.action.resize?.height?.toString() ?? '')

  function submit(event) {
    event.preventDefault()
    const resize = resizeEnabled
      ? Object.fromEntries([['width', width], ['height', height]].filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)]))
      : null
    onSave({
      ...(initial ? { id: initial.id } : {}),
      name,
      enabled,
      priority: Number(priority),
      match: { inputFormat },
      action: { outputFormat, quality: Number(quality), resize: resize && Object.keys(resize).length ? resize : null },
    })
  }

  return (
    <form className="rule-editor" onSubmit={submit}>
      <div className="editor-heading"><div><span className="eyebrow">{initial ? 'EDIT WORKFLOW' : 'NEW WORKFLOW'}</span><h2>{initial ? 'Update automation rule' : 'Set up an automation rule'}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close rule editor">×</button></div>
      <div className="form-grid">
        <label className="form-field form-field-wide"><span>Rule name</span><input aria-label="Rule name" value={name} onChange={(event) => setName(event.target.value)} minLength={1} maxLength={120} required placeholder="For example, JPEG to WebP" /></label>
        <label className="form-field"><span>When input format is</span><select aria-label="Input format" value={inputFormat} onChange={(event) => setInputFormat(event.target.value)}>{INPUT_FORMATS.map((format) => <option key={format} value={format}>{formatLabel(format)}</option>)}</select></label>
        <label className="form-field"><span>Convert to</span><select aria-label="Output format" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>{OUTPUT_FORMATS.map((format) => <option key={format} value={format}>{formatLabel(format)}</option>)}</select></label>
        <label className="form-field"><span>Quality <strong>{quality}%</strong></span><input aria-label="Rule quality" type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>
        <label className="form-field"><span>Priority</span><input aria-label="Rule priority" type="number" min="0" max="10000" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
        <label className="form-field form-field-wide resize-choice"><input type="checkbox" checked={resizeEnabled} onChange={(event) => setResizeEnabled(event.target.checked)} /><span>Resize output (optional)</span></label>
        {resizeEnabled && <>
          <label className="form-field"><span>Maximum width (px)</span><input aria-label="Maximum width" type="number" min="1" max="32768" value={width} onChange={(event) => setWidth(event.target.value)} placeholder="Keep original" /></label>
          <label className="form-field"><span>Maximum height (px)</span><input aria-label="Maximum height" type="number" min="1" max="32768" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="Keep original" /></label>
        </>}
        <label className="form-field form-field-wide resize-choice"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Enable this rule immediately</span></label>
      </div>
      <div className="editor-actions"><button type="button" className="button button-subtle" onClick={onCancel} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{initial ? 'Save changes' : 'Create rule'}</button></div>
    </form>
  )
}

function HistoryPage({ history, busy, onRefresh }) {
  const [query, setQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const filtered = history.filter((item) => {
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter
    const text = `${item.original_filename} ${item.input_format} ${item.output_format} ${item.error_message ?? ''}`.toLowerCase()
    return matchesStatus && text.includes(query.trim().toLowerCase())
  })
  async function openOutput(item) {
    await performAction(
      () => window.autoCompress.openHistoryOutputLocation(item.id),
      'Output location opened.',
    )
  }

  return (
    <>
      <PageIntro eyebrow="JOB RECORDS" title="Review your processing history" description="See the outcome, formats, and storage impact of each completed, failed, or cancelled job." action={<button className="button button-subtle" onClick={() => performAction(onRefresh, 'History refreshed.')} disabled={busy}><Activity size={15} /> Refresh</button>} />
      <div className="history-toolbar">
        <label className="search-field"><Search size={16} /><input aria-label="Search history" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames or formats" /></label>
        <label className="filter-field"><span>Status</span><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All results</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
      </div>
      {filtered.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>FILE</th><th>FORMATS</th><th>STATUS</th><th>ORIGINAL</th><th>FINAL</th><th>SPACE SAVED</th><th>DURATION</th><th>COMPLETED</th><th>OUTPUT</th></tr></thead><tbody>{filtered.map((item) => <HistoryTableRow key={item.id} item={item} busy={busy} onOpenOutput={() => openOutput(item)} />)}</tbody></table></div> : <EmptyState icon={Archive} title={history.length ? 'No matching history' : 'Your history is empty'} description={history.length ? 'Try another search or status filter.' : 'Processed images will appear here when a job finishes.'} />}
      <p className="history-footnote">Showing up to 100 recent records. Original files are preserved.</p>
    </>
  )
}

function HistoryTableRow({ item, busy, onOpenOutput }) {
  return <tr>
    <td><div className="history-file"><FileImage size={16} /><span title={item.source_path}>{item.original_filename || item.source_path}</span></div>{item.error_message && <small className="row-error">{item.error_message}</small>}</td>
    <td><span className="format-badge">{formatLabel(item.input_format)} <ArrowRight size={12} /> {formatLabel(item.output_format)}</span></td>
    <td><StatusBadge status={item.status} /></td>
    <td>{formatBytes(item.original_size)}</td>
    <td>{formatBytes(item.output_size)}</td>
    <td>{item.status === 'completed' ? <span className={item.space_saved >= 0 ? 'space-positive' : 'space-negative'}>{item.space_saved >= 0 ? '−' : '+'}{formatBytes(Math.abs(item.space_saved))}{item.original_size ? ` (${Math.round((item.space_saved / item.original_size) * 100)}%)` : ''}</span> : '—'}</td>
    <td>{formatDuration(item.duration_ms)}</td>
    <td>{formatDate(item.completed_at)}</td>
    <td>{item.status === 'completed' && item.output_path && <button className="text-button output-location-button" onClick={onOpenOutput} disabled={busy} aria-label={`Open output location for ${item.original_filename}`}><FolderOpen size={13} /> Show</button>}</td>
  </tr>
}

function SupportedFormatsPage({ capabilities }) {
  const unimplemented = [
    { name: 'ZIP extraction', detail: 'Only archive recompression is implemented.' },
    { name: 'PDF content editing', detail: 'Page edits and embedded-image downsampling are not implemented.' },
    { name: 'Other audio codecs', detail: 'Only PCM 16-bit WAV processing is implemented.' },
    { name: 'Video transcoding', detail: 'MP4 processing changes metadata layout only; it does not re-encode.' },
    { name: 'Office format conversion', detail: 'DOCX, XLSX, and PPTX are recompressed only in their original format.' },
  ]
  const processorDescriptions = {
    image: 'Image conversion, quality controls, and optional resizing.',
    zip: 'Streams existing ZIP entries into a new archive with maximum DEFLATE compression.',
    pdf: 'Validates and reserializes PDF files using object streams.',
    audio: 'Downmixes PCM 16-bit WAV to mono and reduces sample rate to at most 22.05 kHz.',
    video: 'Moves non-fragmented MP4 metadata ahead of media data and adjusts chunk offsets.',
    document: 'Validates and recompresses DOCX, XLSX, and PPTX package contents.',
  }

  return (
    <>
      <PageIntro eyebrow="PROCESSOR CAPABILITIES" title="Supported formats and operations" description="Capabilities are loaded from the registered processing backends. Formats are identified from file contents, not file extensions." />
      {capabilities.map((processor) => {
        const inputFormats = processor.id === 'image' ? INPUT_FORMATS : processor.inputFormats
        const outputFormats = processor.id === 'image' ? [...OUTPUT_FORMATS, 'bmp'] : processor.outputFormats
        return <section className="capability-card" key={processor.id}>
          <div className="capability-heading"><div className="setting-icon"><FileImage size={18} /></div><div><h2>{processor.name}</h2><p>{processorDescriptions[processor.id]}</p></div><span className="capability-status is-supported">Supported</span></div>
          <div className="capability-grid">
            <div><h3>Input formats</h3><FormatList formats={inputFormats} supported={new Set(processor.inputFormats)} /></div>
            <div><h3>Output formats</h3><FormatList formats={outputFormats} supported={new Set(processor.outputFormats)} /></div>
          </div>
        </section>
      })}
      {!capabilities.length && <EmptyState icon={CircleAlert} title="No processors are registered" description="File processing is unavailable in this build." />}
      <section className="content-section unimplemented-section">
        <div className="section-heading"><div><span className="eyebrow">PROCESSING LIMITS</span><h2>Not implemented</h2></div></div>
        <div className="unimplemented-grid">{unimplemented.map((item) => <article className="unimplemented-card" key={item.name}><span className="capability-status not-implemented">Not implemented</span><h3>{item.name}</h3><p>{item.detail}</p></article>)}</div>
      </section>
    </>
  )
}

function FormatList({ formats, supported }) {
  return <ul className="format-list">{formats.map((format) => {
    const isSupported = supported.has(format)
    return <li key={format}><span>{formatLabel(format)}</span><span className={`capability-status ${isSupported ? 'is-supported' : 'not-implemented'}`}>{isSupported ? 'Supported' : 'Not implemented'}</span></li>
  })}</ul>
}

function SettingsPage({ settings, status, busy, onSettingsChange }) {
  if (!settings) return null
  async function update(patch, label = 'Settings saved.') {
    const updated = await performAction(() => window.autoCompress.updateSettings(patch), label)
    if (updated) onSettingsChange(updated)
  }
  async function chooseOutput() {
    const folder = await performAction(() => window.autoCompress.selectOutputFolder(), null)
    if (folder) await update({ defaultOutputFolder: folder }, 'Output folder updated.')
  }
  async function openOutput() {
    await performAction(() => window.autoCompress.openOutputFolder(), 'Output folder opened.')
  }

  return (
    <>
      <PageIntro eyebrow="APP PREFERENCES" title="Tune your workspace" description="These settings are stored locally and apply to one-time and automated processing." />
      <div className="settings-grid settings-grid-page">
        <article className="setting-card"><div className="setting-icon"><FolderOpen size={18} /></div><div className="setting-body"><h3>Output folder</h3><p>Processed copies are written here. Source files are preserved.</p><div className="path-picker"><span title={settings.defaultOutputFolder}>{settings.defaultOutputFolder || 'Not selected'}</span><button onClick={chooseOutput} disabled={busy} aria-label="Choose output folder"><FolderOpen size={16} /></button></div><button className="text-button output-open" onClick={openOutput} disabled={busy || !settings.defaultOutputFolder} title={settings.defaultOutputFolder ? 'Open the configured output folder' : 'Choose an output folder first'}><ArrowDownToLine size={14} /> Open output folder</button></div></article>
        <article className="setting-card"><div className="setting-icon"><Gauge size={18} /></div><div className="setting-body"><h3>Image quality</h3><p>Default quality for manual image conversion.</p><QualityControl value={settings.defaultQuality} disabled={busy} onSave={(value) => update({ defaultQuality: value })} /></div></article>
        <article className="setting-card"><div className="setting-icon"><Activity size={18} /></div><div className="setting-body"><h3>Parallel jobs</h3><p>Maximum number of images processed at the same time.</p><label className="select-row"><span>Concurrency</span><select aria-label="Parallel jobs" value={settings.maxConcurrency} disabled={busy} onChange={(event) => update({ maxConcurrency: Number(event.target.value) })}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'job' : 'jobs'}</option>)}</select></label></div></article>
        <article className="setting-card"><div className="setting-icon"><Settings2 size={18} /></div><div className="setting-body"><h3>Appearance & behavior</h3><p>Control the app's visual theme and background behavior.</p><label className="select-row"><span>Theme</span><select aria-label="Theme" value={settings.theme} disabled={busy} onChange={(event) => update({ theme: event.target.value })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><Toggle label="Notifications" checked={settings.notifications} disabled={busy} onChange={(value) => update({ notifications: value })} /><Toggle label="Minimize to tray" checked={settings.minimizeToTray} disabled={busy} onChange={(value) => update({ minimizeToTray: value })} /><Toggle label="Start with Windows" checked={settings.launchAtStartup} disabled={busy} onChange={(value) => update({ launchAtStartup: value })} /></div></article>
      </div>
      <section className="privacy-card"><ShieldCheck size={18} /><div><h3>Local-first by design</h3><p>Images are processed on this device. AutoCompress does not upload your files.</p></div></section>
      <div className="settings-meta"><span>Version {status?.version}</span><span>Platform {status?.platform}</span><span>{status?.trayAvailable ? 'System tray available' : 'System tray unavailable'}</span></div>
    </>
  )
}

function QualityControl({ value, disabled, onSave }) {
  const [draft, setDraft] = React.useState(value)
  const lastSaved = React.useRef(value)
  React.useEffect(() => setDraft(value), [value])
  React.useEffect(() => { lastSaved.current = value }, [value])
  function commit(event) {
    const next = Number(event.currentTarget.value)
    setDraft(next)
    if (next !== lastSaved.current) {
      lastSaved.current = next
      onSave(next)
    }
  }
  return <label className="range-row"><input aria-label="Default image quality" type="range" min="1" max="100" value={draft} disabled={disabled} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><strong>{draft}</strong></label>
}

function PageIntro({ eyebrow, title, description, action }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action && <div className="page-intro-action">{action}</div>}</div>
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true" /></label>
}

function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}

function ActivityRow({ job, busy, onCancel }) {
  const canCancel = ['queued', 'processing'].includes(job.status)
  const fileLabel = job.displayName ?? job.source_path?.split(/[\\/]/).filter(Boolean).pop()
  return <div className="activity-row"><span className="activity-icon"><FileImage size={16} /></span><div className="activity-copy"><strong>{fileLabel || `Job ${job.id.slice(0, 8)}`}</strong><small>{job.result?.outputFormat ? `Converted to ${formatLabel(job.result.outputFormat)}` : job.error?.message ?? 'Image processing'}</small></div><StatusBadge status={job.status} />{canCancel && <button className="text-button cancel-job-button" onClick={onCancel} disabled={busy}>Cancel</button>}</div>
}

function HistoryRow({ item }) {
  return <div className="activity-row"><span className="activity-icon"><FileImage size={16} /></span><div className="activity-copy"><strong title={item.source_path}>{item.original_filename || item.source_path}</strong><small>{formatLabel(item.input_format)} to {formatLabel(item.output_format)} · {formatBytes(item.original_size)}</small></div><div className="history-row-result"><StatusBadge status={item.status} />{item.status === 'completed' && <small>{item.space_saved >= 0 ? 'Saved ' : 'Added '}{formatBytes(Math.abs(item.space_saved))}</small>}</div></div>
}

function StatusBadge({ status }) {
  const label = status ? status[0].toUpperCase() + status.slice(1) : 'Unknown'
  return <span className={`status-badge status-${status}`}>{label}</span>
}

const INPUT_FORMATS = ['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp']
const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'avif', 'tiff']
const PROCESSING_INPUTS = [
  { value: 'image', label: 'Images', processorId: 'image' },
  { value: 'zip', label: 'ZIP archives', processorId: 'zip' },
  { value: 'pdf', label: 'PDF documents', processorId: 'pdf' },
  { value: 'wav', label: 'WAV audio', processorId: 'audio' },
  { value: 'mp4', label: 'MP4 video', processorId: 'video' },
  { value: 'docx', label: 'DOCX documents', processorId: 'document' },
  { value: 'xlsx', label: 'XLSX spreadsheets', processorId: 'document' },
  { value: 'pptx', label: 'PPTX presentations', processorId: 'document' },
]

function getProcessingTypes(capabilities) {
  return PROCESSING_INPUTS.flatMap((type) => {
    const processor = capabilities.find(({ id }) => id === type.processorId)
    if (!processor) return []
    const inputFormats = type.value === 'image' ? processor.inputFormats : [type.value]
    if (inputFormats.some((format) => !processor.inputFormats.includes(format))) return []
    return [{
      ...type,
      inputFormats,
      outputFormats: type.value === 'image'
        ? processor.outputFormats
        : type.processorId === 'document'
          ? [type.value]
          : processor.outputFormats,
    }]
  })
}

function formatLabel(format) {
  if (!format) return 'Unknown'
  return format.toUpperCase().replace('JPEG', 'JPEG').replace('TIFF', 'TIFF')
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
