# User Guide

## Install

Build `AutoCompress-<version>-x64.exe` with `npm run dist:win`, then run the installer. It installs per-user, can create Start Menu/Desktop shortcuts, and lets you choose the installation directory. The installer is unsigned, so Windows may display a SmartScreen warning.

## Configure settings

1. Open **Settings** and choose an output folder.
2. Set default image quality and maximum concurrent jobs.
3. Choose a theme and configure notifications, Windows startup, and minimize-to-tray behavior.

Processed files are saved in the selected output folder. The source files are preserved. **Open output folder** opens the configured destination.

## Process images

1. Open **File Processing**.
2. Choose an output format, quality, and optional maximum width/height.
3. Select **Choose images** to open the native multi-file picker, or drop files into the drop zone.
4. Follow queued/processing jobs in Progress. Completed and failed results appear in History.

Supported inputs and outputs are listed in [SUPPORTED_FORMATS.md](./SUPPORTED_FORMATS.md). File content, not the extension, determines the actual type.

## Automate new files

1. Open **Watched folders** and add a folder.
2. Open **Automation** and create a rule with input format, output format, quality, optional resize, and priority.
3. Monitoring applies the highest-priority enabled rule matching each new image. Existing files are not scanned.
4. Use the top-bar pause/resume action to control monitoring. Rules can be enabled, disabled, edited, or deleted.

Temporary/incomplete writes and symlinks are ignored. Configure an output folder outside watched folders where possible; output subtrees are excluded to avoid loops.

## Review results

**History** shows status, formats, original/final size, saved space, duration, and errors. Search by filename/format, filter by status, or choose **Show** to reveal a completed output in Explorer. The Dashboard summarizes totals and monitored folders.

## Tray and uninstall

When minimize-to-tray is enabled, closing the window hides AutoCompress in the system tray. Use the tray menu to reopen or quit.

Uninstall removes the application and shortcuts but leaves local settings and history intact. To remove that data too, close AutoCompress and delete its per-user application-data directory (typically `%APPDATA%\\AutoCompress`).
