# Architecture

AutoCompress is a local-first Electron application. Its renderer presents the UI; privileged filesystem, database, watcher, queue, and notification work stays in the main process.

## Components

- **Electron main** (`src/main/index.js`): owns the window/tray lifecycle, SQLite repositories, settings, job queue, processor registry, notifications, and folder watchers.
- **Preload** (`src/preload/index.cjs`): exposes named operations with `contextBridge`. It does not expose generic filesystem, process, or IPC access.
- **Renderer** (`src/renderer/main.jsx`): React pages and Zustand state. It only requests backend actions and renders returned results.
- **Processing** (`src/main/processing/`): detects image formats from content, runs Sharp in worker threads, validates outputs, and saves without overwriting existing files.
- **Automation** (`src/main/automation/`): persists watched folders/rules and processes stable new files with Chokidar.
- **Database** (`src/main/db/`): versioned SQLite migrations and repositories under Electron's per-user data directory.

## Data flows

### Manual conversion

1. The renderer chooses output format, quality, and optional resize limits.
2. Main opens the native multi-file picker, or preload converts dropped `File` objects to paths with Electron `webUtils`.
3. Main validates options, output folder, and dropped paths; the processor independently rejects symlinks/non-regular files and identifies content by signature.
4. The queue fingerprints inputs, persists jobs, enforces configured concurrency, and runs Sharp in a worker thread.
5. The processor validates the output and finalizes to a collision-safe path. The source remains untouched.
6. Job/history events update the UI and SQLite-backed dashboard totals. Completion/failure notifications respect the user's setting.

### Folder automation

1. The user selects a folder through a native dialog and configures a rule.
2. Chokidar observes enabled folders, waiting for stable writes and excluding temporary files, symlinks, and configured output paths.
3. Content inspection selects the highest-priority enabled matching rule.
4. The same queue, worker, output finalization, history, and notification path handles the job.

## Persistence and recovery

SQLite migrations create settings, monitored folders, automation rules, processing jobs, and history. Job fingerprints prevent repeat processing. Interrupted queued/processing jobs are marked failed during startup recovery before monitoring resumes.

## Packaging

Electron Builder packages the renderer, main process, preload, and production dependencies into an ASAR-backed Windows x64 NSIS installer. Native `.node` binaries are unpacked. Packaging skips dependency rebuilds and uses the installed Node-API binaries; source rebuilding is available through `npm run rebuild:native` and requires Visual Studio C++ Build Tools and the Windows SDK on Windows. The packaged smoke test verifies the installed application, SQLite, Sharp, monitoring, processing, and uninstall behavior.
