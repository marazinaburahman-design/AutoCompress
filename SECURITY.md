# Security

## Trust boundaries

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and sandboxing. Its CSP restricts scripts, frames, navigation, and connections.
- Preload exposes a fixed, narrow API. Every IPC handler verifies the main frame and trusted origin and validates argument count and payload shape.
- File and folder selection uses native dialogs. Dragged file paths are resolved in preload with Electron `webUtils`; the main process validates requests, and image inspection rejects symlinks and non-regular files.
- The renderer does not receive Node.js filesystem or process APIs. It cannot provide an arbitrary output path to the processor; output location comes from validated settings.

## File handling

- Input type is determined from file signatures rather than filenames.
- The processor writes a separate result, validates it, and uses collision-safe finalization. Originals are never overwritten or deleted by default.
- Watched folders ignore temporary files and symlinks, wait for stable writes, deduplicate events, and exclude the configured output subtree.
- The history "Show" action accepts a history-record ID, retrieves its persisted output path in the main process, checks the file, and asks Windows Explorer to reveal it.
- Processing occurs locally. The app does not upload files or use a cloud backend.

## Process and dependency limitations

Worker threads keep image work responsive but are not an OS security sandbox. Only process files from locations you trust. Electron and native dependencies are pinned in `package.json`/`package-lock.json`; packaging skips native dependency rebuilding and ships the installed Node-API binaries, which the packaged smoke test exercises. Rebuilding native dependencies from source requires the Visual Studio C++ Build Tools and Windows SDK on Windows. The `minimatch` override pins the audited transitive tree to 11.0.1.

The NSIS installer is not code-signed. Windows SmartScreen may show a publisher warning. No automatic update service is configured. Uninstall removes program files and shortcuts but intentionally preserves local settings/history in the user's application-data directory.

Report security issues privately to the project maintainers before public disclosure.
