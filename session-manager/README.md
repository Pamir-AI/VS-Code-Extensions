# Happy Session Manager

Manage Claude Code and Codex sessions from VS Code with seamless migration between mobile (Happy) and desktop environments.

## What is Happy Session Manager?

Happy Session Manager provides a unified interface to manage all your Claude Code and Codex sessions running through the Happy server. View sessions grouped by directory, monitor their status in real-time, and migrate active sessions from your mobile device to your desktop terminal with one click.

## Features

- **Session Tree View**: Browse all active, idle, and terminated sessions organized by working directory
- **Phone-to-Desktop Migration**: Resume Happy (mobile) sessions directly in your VS Code integrated terminal with automatic cleanup
- **Smart Session Killing**: Terminate sessions with proper process cleanup and metadata removal
- **Transcript Preview**: View session conversation history in the output channel
- **Session Management**: Copy session IDs, open working directories in new windows
- **Real-time Status**: Auto-refresh every 5 seconds with color-coded status indicators
- **Status Bar Integration**: Quick view of active session count
- **Platform Detection**: Visual distinction between Happy (mobile) and vanilla (desktop) sessions
- **Engine Badges**: Clearly labeled Claude (CL) and Codex (CX) sessions
- **Activity Indicators**: Track whether sessions are busy processing or idle

## Requirements

- Happy server running at `http://127.0.0.1:3005` (default)
- Claude CLI installed and accessible in PATH
- Happy CLI (optional, for advanced workflows)

## Installation

Install from Open VSX:

1. Open VS Code or Code-Server
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Happy Session Manager"
4. Click Install

Alternatively, install the `.vsix` file manually:

```bash
code --install-extension happy-session-manager-1.0.0.vsix
```

## Configuration

This extension contributes the following settings:

### `happySessions.serverUrl`
- **Type**: `string`
- **Default**: `http://127.0.0.1:3005`
- **Description**: Happy server URL for API requests

### `happySessions.authToken`
- **Type**: `string`
- **Default**: `""` (empty for localhost development)
- **Description**: Happy authentication token (JWT). Leave empty for localhost development.

### `happySessions.cliPath`
- **Type**: `string`
- **Default**: `""` (auto-detected)
- **Description**: Path to happy CLI binary. Auto-detected if empty.

## Usage

### Viewing Sessions

Open the Session Manager view from the activity bar (layers icon). Sessions are grouped by working directory and sorted by most recent activity.

Session status indicators:
- Green icon: Active and processing (busy)
- Yellow icon: Active but idle
- Red icon: Terminated or error
- Phone icon: Running on Happy (mobile device)
- Desktop icon: Running locally (vanilla Claude)

### Resuming Sessions (Phone to Desktop)

To move a Happy session from your phone to your desktop terminal:

1. Right-click a session with a phone icon
2. Click "Resume Session" or click the play button
3. The extension will:
   - Kill the remote process on your phone
   - Wait for PID cleanup
   - Clear Happy metadata
   - Resume the session in VS Code integrated terminal

**Note**: This only works for Claude sessions. Codex sessions are read-only and cannot be resumed.

### Killing Sessions

To terminate a session:

1. Right-click any session
2. Select "Kill Session"
3. The extension will:
   - Send termination signal to the specific process PID
   - Poll until process cleanup completes
   - Clear Happy metadata if applicable

### Preview Transcript

View the full conversation history for any session:

1. Right-click a session
2. Select "Preview Transcript"
3. View the JSONL transcript in the output channel

### Open Working Directory

Navigate to a session's working directory:

1. Right-click a session
2. Select "Open in Explorer"
3. Directory opens in a new VS Code window

### Copy Session ID

Copy the full session ID to clipboard for use in scripts or debugging:

1. Right-click a session
2. Select "Copy Session ID"

## Known Limitations

- **Codex Sessions**: Codex sessions are read-only and cannot be resumed via the Happy API. They can only be viewed and killed.
- **Polling Timeout**: Session migration may fail if process cleanup takes longer than 10 seconds.
- **Authentication**: Auth token support is present but not fully tested for remote Happy servers.

## Troubleshooting

### Sessions Not Appearing
- Verify Happy server is running: `curl http://127.0.0.1:3005/health`
- Check server URL in settings matches your Happy server

### Resume Not Working
- Ensure Claude CLI is in PATH: `which claude`
- Check terminal for error messages
- Verify session is a Claude session (not Codex)

### Kill Session Fails
- Session may have already terminated
- Check Happy server logs for errors
- Try manual kill: `happy kill <session-id>`

## Privacy

This extension communicates only with your local Happy server. No data is sent to external services.

## License

Apache-2.0

## Repository

https://github.com/Pamir-AI/VS-Code-Extensions

## Issues

Report bugs at: https://github.com/Pamir-AI/VS-Code-Extensions/issues
