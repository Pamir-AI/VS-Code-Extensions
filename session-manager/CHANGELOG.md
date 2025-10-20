# Change Log

All notable changes to the "session-manager" extension will be documented in this file.

## [0.3.0] - 2025-10-16

### Changed
- **UI Improvements**: Rebranded activity bar from "Happy Sessions" to "Session Manager"
- **Icon Update**: Changed to layers icon `$(layers)` for better visual representation
- **View Title**: Renamed "Claude Sessions" to "Active Sessions"
- **Open in Explorer**: Now opens directories in new window instead of replacing current window
- **Kill Session**: Now uses consistent behavior with Resume - includes targetPid, polling, and metadata cleanup
- **Directory Expansion**: Folders now expand by default for better visibility

### Fixed
- Kill session now properly clears Happy metadata to prevent stale phone icon display
- Consistent session cleanup across all operations

## [0.2.0] - 2025-10-16

### Added
- Session tree view grouped by directory with real-time updates
- Move Happy sessions from phone to VS Code terminal
- Kill active sessions with proper cleanup
- Preview session transcripts in output channel
- Copy session ID to clipboard
- Open session directory in VS Code
- Auto-refresh every 5 seconds
- Status bar showing active session count
- Visual distinction between Happy (mobile) and vanilla (desktop) sessions
- Session status indicators (active/busy, active/idle, terminated)

### Features
- **Smart Session Migration**: Automatically kills phone process, clears Happy metadata, and resumes in local terminal
- **Polling-based Verification**: Ensures clean state transitions before resuming sessions
- **API + CLI Hybrid**: Uses Happy server API with CLI fallback for reliability
- **Configurable Settings**: Server URL, auth token, and CLI path

## [0.1.0] - 2025-10-07

- Initial development release