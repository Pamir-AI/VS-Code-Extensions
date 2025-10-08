# Happy Session Manager

Manage Happy Claude sessions from VS Code.

## Features

- View all Claude sessions in VS Code sidebar
- Resume sessions in integrated terminal
- Copy session IDs to clipboard
- Open session working directories
- Color-coded status indicators (active/idle/terminated)

## Requirements

- happy-server running at http://127.0.0.1:3005
- happy-cli installed at /opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs

## Extension Settings

This extension contributes the following settings:

* `happySessions.serverUrl`: Happy server URL for API requests (default: http://127.0.0.1:3005)
* `happySessions.cliPath`: Path to happy CLI binary (auto-detected if empty)

## Release Notes

### 0.1.0

Initial MVP release with core session management features.
