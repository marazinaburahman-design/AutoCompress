# AutoCompress

AutoCompress is a local-first Windows desktop application for safe file processing. This repository is under staged development; features are only advertised after their implementation and verification.

## Development and verification

Requirements: Windows 10/11 x64, Node.js 22.12 or newer, and npm. Native-module source builds may additionally require the Visual Studio C++ Build Tools and Windows SDK.

```powershell
npm install
npm test
npm run test:electron
npm run build
npm run dev
```

`better-sqlite3` 13.0.3 supplies a platform-specific Windows binary built against Node-API, which is ABI-stable; `npm run test:electron` exercises the module in Electron. For a custom Electron or module build, use `npm run rebuild:native` (requires the Visual Studio C++ Build Tools and Windows SDK on Windows). Stop the app before rebuilding native modules.

`npm start` builds the renderer and launches the local app. To produce and test the Windows x64 NSIS installer, run `npm run dist:win` and then `npm run test:packaged`. The packaged smoke test installs into a temporary directory, exercises the installed app, uninstalls it, and removes its temporary files.

## Stage 1 foundation

The desktop shell uses Electron with renderer sandboxing, context isolation, disabled Node integration, a restrictive content security policy, and a narrow `contextBridge` API. SQLite is stored in Electron's per-user application data folder. Versioned migrations create the settings, watched-folder, automation-rule, job, and history tables. The tray menu can reopen the window or quit the application.

The renderer can only update whitelisted settings through validated IPC. Folder selection uses the native directory picker. The renderer does not receive filesystem or process APIs.

## Stage 2 image processing

Image inputs are identified by file signature rather than their filename extension and processed in bounded worker threads. The engine supports conversion to PNG, JPEG, WebP, AVIF, and TIFF, optional resizing, collision-safe output names, and preserves originals. Jobs and processing history are persisted in SQLite; duplicate inputs are fingerprinted to avoid redundant work.

## Stage 3 folder automation

Watched folders and automation rules are persisted in SQLite. Chokidar monitoring waits for files to finish copying, ignores temporary files and symlinks, prevents duplicate event processing, and excludes configured output folders to prevent recursive processing. Monitoring can be paused and resumed, and watcher state is restored from persisted configuration.

## Stage 4 user interface

The renderer includes dashboard, file-processing, watched-folder, automation, history, supported-formats, and settings pages. Manual conversions support native multi-file selection and drag/drop; formats, quality, and optional resize dimensions are configurable. The dashboard reads lifetime processing totals from SQLite. History includes sizes, savings, duration, failures, and a main-process action to reveal completed outputs. All pages use backend IPC data; renderer code receives no Node.js or general filesystem APIs.

Run `npm run test:electron` to exercise the application in Electron, including folder/rule workflows, native multi-file conversion, drag/drop, history filters and output reveal, dashboard totals, and settings persistence. The smoke test uses temporary directories and removes them after completion.

## Stage 5 Windows packaging

The Windows x64 installer uses Electron Builder 26.18.0 and NSIS. The application version comes from `package.json`; installer metadata, shortcuts, icon, ASAR settings, and unpacking of native `.node` binaries are configured there. Packaging currently skips dependency rebuilds and uses the installed Node-API prebuilds, which are ABI-stable; the packaged smoke test verifies the installed SQLite and Sharp workflows. Rebuilding native modules from source with `npm run rebuild:native` requires the Visual Studio C++ Build Tools and Windows SDK on Windows. The installer is currently unsigned. Uninstall removes program files and shortcuts while preserving the user's settings and job history.

The packaging dependency graph pins `minimatch` 11.0.1 through npm overrides to address the advisory affecting older transitive versions. Re-run `npm audit` after dependency changes.

## Stage 6 additional processors

The verified ZIP processor streams existing archives into new ZIP files using maximum DEFLATE compression, with entry-count and uncompressed-size limits; password-protected archives and symbolic links are rejected. The PDF processor validates and reserializes unencrypted documents with object streams and checks that the page count survives. The WAV processor downmixes supported PCM16 audio to mono and resamples to at most 22.05 kHz in a worker. The MP4 processor moves non-fragmented movie metadata ahead of media data and updates chunk offsets; it preserves encoded streams without transcoding. The DOCX/XLSX/PPTX processor validates required OOXML XML parts and namespaces, rejects DTDs, then losslessly recompresses package parts. None of these operations modifies the source. ZIP extraction, PDF page-content changes, other audio formats/codecs, video transcoding, and conversion between office document formats remain unimplemented. See [SUPPORTED_FORMATS.md](./SUPPORTED_FORMATS.md) for the exact tested formats.

The Stage 6 processors use MIT-licensed `yauzl`, `yazl`, and `pdf-lib`, plus ISC-licensed `saxes`; audio and video processing use Node.js APIs without bundled FFmpeg or other external codecs.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) describes process boundaries and the processing pipeline.
- [SECURITY.md](./SECURITY.md) documents the trust boundaries and filesystem protections.
- [USER_GUIDE.md](./USER_GUIDE.md) describes installation and application workflows.
- [SUPPORTED_FORMATS.md](./SUPPORTED_FORMATS.md) lists implemented and unimplemented processors.

## Dependency decisions

The required app stack is pinned in `package.json` to the stable versions checked for this project. Additional development/build packages have focused purposes:

- `@electron/rebuild` supports explicit native dependency rebuilds for Electron's ABI, distinct from the installed Node.js ABI.
- `electron-builder` creates the Windows NSIS installer; packaging reuses the installed Node-API native binaries (`npmRebuild: false`).
- `Vitest` runs automated unit/integration tests; Playwright verifies Electron UI and packaged workflows.
- `file-type` identifies actual file signatures rather than trusting file extensions, which is essential before processing untrusted files.
- `yauzl`/`yazl`, `pdf-lib`, and `saxes` provide ZIP streaming, PDF parsing/serialization, and strict OOXML parsing; their licenses were checked before adoption.

Check `package-lock.json` into source control to preserve the resolved dependency tree. Run `npm audit` before release and investigate each reported advisory.
