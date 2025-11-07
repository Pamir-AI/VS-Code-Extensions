# Pamir Messaging Manager

VSCode extension for managing Slack webhook integrations on Pamir CM5 devices.

## Overview

This extension simplifies the process of connecting your Pamir device to Slack workspaces using OAuth-based webhooks with real-time delivery via Socket.IO. It provides a seamless interface for setup, status checking, and management of Slack integrations.

## Features

- **Setup Slack Messaging**: OAuth flow to authorize Slack integration with real-time webhook delivery
- **View Status**: Display current webhook configuration and device information
- **Send Test Message**: Send device stats (temperature, memory, uptime, CPU) to Slack as a formatted Block Kit message
- **Copy Webhook URL**: Quickly copy webhook URL to clipboard for use with coding agents
- **Remove Integration**: Clean up local webhook configuration
- **Automatic Device Detection**: Retrieves device MAC address automatically via system utilities
- **Real-time WebSocket Delivery**: Instant webhook callback via Socket.IO (no polling!)
- **code-server Support**: Works in both native VSCode and browser-based code-server

## Requirements

- Pamir CM5 device with Distiller SDK installed
- Python 3 with `/opt/distiller-telemetry/get_mac.py` available
- Internet connection for OAuth flow
- User home directory write permissions (`~/.messaging/`)

## Installation

### From .vsix Package

```bash
code-server --install-extension distiller-messaging-0.1.0.vsix --force
```

### From Source

```bash
cd messaging-manager
npm install --include=dev
npm run compile
vsce package --allow-missing-repository
code-server --install-extension distiller-messaging-0.1.0.vsix --force
```

## Usage

### Initial Setup

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Run: **Pamir: Setup Slack Messaging**
3. Browser opens to Slack authorization page
4. Select the Slack channel where messages should be sent
5. Extension receives webhook instantly via Socket.IO
6. Done! Webhook stored in `~/.messaging/webhook.json`

### View Configuration Status

1. Open Command Palette
2. Run: **Pamir: View Messaging Status**
3. View device info, Slack workspace, and channel details

### Reconfigure (Change Channel)

1. Run: **Pamir: Setup Slack Messaging** again
2. Creates new webhook and overwrites previous configuration
3. Old webhook remains active in Slack but device uses new one

### Remove Integration

1. Open Command Palette
2. Run: **Pamir: Remove Slack Integration**
3. Confirm removal
4. Local configuration deleted (webhook remains active in Slack until manually revoked)

## Architecture

### Flow Diagram

```
VSCode Extension → Get MAC Address → Socket.IO Connection
                                    ↓
                          Open Browser (OAuth)
                                    ↓
                          User Authorizes Slack
                                    ↓
                   Server sends webhook via Socket.IO
                                    ↓
                   Extension receives instantly
                                    ↓
                   Saves to ~/.messaging/webhook.json
```

### Key Technologies

- **Flask-SocketIO**: Real-time bidirectional communication
- **Socket.IO Client**: Extension connects and waits for webhook
- **DynamoDB**: Device verification (MAC address lookup)
- **Stateless Server**: No webhook storage on server
- **Transport**: HTTP Long-polling with WebSocket upgrade attempt

### File Storage

Webhook configuration stored in `~/.messaging/webhook.json`:

```json
{
  "device_id": "naruto",
  "webhook_url": "https://hooks.slack.com/services/...",
  "channel": "@ye.tianqi1900",
  "team_name": "Pamir",
  "team_id": "",
  "configured_at": "2025-10-31T19:04:45.604Z"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `pamir.setupMessaging` | Setup or reconfigure Slack integration |
| `pamir.viewStatus` | View current configuration status |
| `pamir.testMessage` | Send test message with device stats to Slack |
| `pamir.copyWebhookUrl` | Copy webhook URL to clipboard |
| `pamir.removeIntegration` | Remove local webhook configuration |
| `pamir.refreshView` | Refresh tree view |

## Extension Settings

- **`pamir.messaging.apiUrl`**: Messaging API base URL (default: `https://messaging.pamir.ai`)

## Webhook Management FAQ

**Can I have multiple webhooks?**
Each OAuth authorization creates a new webhook URL in Slack. However, the device only stores ONE webhook at a time. Running setup again will overwrite the previous configuration.

**How do I reconfigure?**
Simply run **Pamir: Setup Slack Messaging** again. This creates a new webhook and updates the local configuration. The old webhook remains active in Slack until you manually revoke it.

**How do I completely remove the webhook?**
1. Device: Run **Pamir: Remove Slack Integration**
2. Slack: Go to Workspace Settings → Apps → Manage → Incoming Webhooks and revoke manually

**Does it work in code-server?**
Yes! The extension uses Socket.IO for real-time delivery, which works perfectly in browser-based code-server. No VSCode URI scheme required.

## Troubleshooting

**"Failed to retrieve MAC address"**
- Ensure `/opt/distiller-telemetry/get_mac.py` exists
- Check Python 3 is installed: `python3 --version`

**"Device verification failed"**
- Check device is registered in DynamoDB `pamir-devices` table
- Verify MAC address matches exactly

**"Messaging server is not responding"**
- Check server health: `curl https://messaging.pamir.ai/health`
- Verify HTTPS is enabled on server

**"websocket error"**
- Server may not have HTTPS properly configured
- Check that Flask-SocketIO server is running
- Verify polling transport is enabled (should be automatic)

**"Setup timed out"**
- Ensure you completed OAuth flow in browser
- State tokens expire after 15 minutes - try again
- Check Socket.IO connection in developer console

## Development

### Project Structure

```
messaging-manager/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── commands/                 # Command implementations
│   │   ├── setupMessaging.ts     # OAuth + Socket.IO flow
│   │   ├── viewStatus.ts         # Status display
│   │   ├── testMessage.ts        # Send test message with stats
│   │   ├── copyWebhookUrl.ts     # Copy webhook URL
│   │   └── removeIntegration.ts  # Cleanup
│   ├── api/
│   │   ├── messagingClient.ts    # HTTP API client
│   │   └── websocketClient.ts    # Socket.IO client
│   ├── device/
│   │   ├── macReader.ts          # MAC address detection
│   │   └── statsReader.ts        # System stats reader (temp, mem, CPU)
│   ├── storage/
│   │   └── webhookStorage.ts     # File I/O (~/.messaging/)
│   ├── ui/
│   │   └── messagingTreeView.ts  # Sidebar tree view
│   └── types/
│       └── index.ts              # TypeScript interfaces
├── dist/                         # Compiled JavaScript
├── distiller-messaging-0.1.0.vsix # Packaged extension
└── package.json                  # Extension manifest
```

### Build Commands

```bash
npm install --include=dev  # Install all dependencies
npm run compile            # Compile TypeScript
npm run watch              # Watch mode
npm run check-types        # Type checking only
npm run lint               # Linting
npm run package            # Production build
vsce package               # Create .vsix package
```

### Testing

```bash
# Install extension
code-server --install-extension distiller-messaging-0.1.0.vsix --force

# Test Socket.IO connection (Python)
cd ../tests
python3 test_socketio.py

# View extension logs
# In code-server: Help → Toggle Developer Tools → Console
```

### Key Implementation Details

**Socket.IO Transport Configuration:**
```typescript
const socket = io(socketUrl, {
  transports: ['polling', 'websocket'],  // Polling first, then upgrade
  reconnection: false
});
```

**Storage Location:**
- Changed from `/etc/pamir/` (requires sudo) → `~/.messaging/` (user writable)
- Uses `os.homedir()` for cross-platform compatibility

**Device Stats:**
- Reads temperature from `/sys/class/thermal/thermal_zone0/temp`
- Reads memory stats from `/proc/meminfo`
- Reads uptime from `/proc/uptime`
- Reads CPU usage from `/proc/stat`
- Formatted as Slack Block Kit message

**Error Handling:**
- Health check before OAuth flow
- 5-minute timeout for Socket.IO waiting
- Proper cleanup on connection close
- Single error message (no duplicates)

## Release Notes

### 0.1.0

Initial release:
- OAuth-based Slack setup with real-time Socket.IO delivery
- Webhook storage in `~/.messaging/webhook.json` (user-writable)
- Status viewing and reconfiguration
- Test message with device stats (temperature, memory, uptime, CPU) formatted as Slack Block Kit
- Copy webhook URL to clipboard for sharing with coding agents
- Integration removal
- code-server support via HTTP long-polling
- HTTPS with proper SSL certificate verification

## License

Proprietary - Pamir.ai
