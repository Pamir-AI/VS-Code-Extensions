# Distiller Port Manager

Monitor and manage development server ports with automatic discovery and proxying on Pamir AI devices.

## Features

- **Automatic Port Discovery**: Detects new localhost ports automatically
- **Tree View**: Organized view of all discovered ports grouped by origin
- **Status Bar**: Quick view of active port count
- **Proxy URLs**: Easy access to proxied URLs for remote access
- **Port Management**: Register, exclude, or manage ports manually
- **Notifications**: Get notified when new ports are discovered

## Usage

Once installed, the extension will automatically start discovering ports running on your Distiller device.

### View Ports

Click on the **Port Manager** icon in the Activity Bar to see all discovered ports.

### Commands

- **Refresh Ports**: Manually refresh the port list
- **Open in Browser**: Open the proxied URL in your browser
- **Register Custom Port**: Add a specific port to forward
- **Exclude/Unexclude Port**: Manage which ports to forward

### Configuration

Configure the extension in VS Code settings:

- `distillerPorts.serverUrl`: Distiller server URL (default: `http://127.0.0.1:3000`)
- `distillerPorts.pollInterval`: How often to check for new ports in milliseconds (default: `2000`)
- `distillerPorts.showNotifications`: Show notifications for newly discovered ports (default: `true`)

## Requirements

- Distiller server running on `localhost:3000` (or configured URL)
- Port discovery API available at `/distiller/proxy/info`

## Release Notes

### 1.0.0

Initial release of Distiller Port Manager
