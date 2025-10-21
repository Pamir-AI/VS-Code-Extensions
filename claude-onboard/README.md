# Device Manager

Manage Claude Code trials, system updates, and e-ink display customization on Distiller CM5 devices.

## What is Device Manager?

Device Manager is a comprehensive device administration extension for the Distiller CM5 platform. It provides a webview-based dashboard for managing your Claude Code trial status, checking and installing system updates via distiller-update, and designing custom e-ink wallpapers with QR code generation.

## Features

- **Claude Code Trial Management**: Start and stop your Claude Code trial on demand with real-time status verification
- **System Updates**: Check for and install system updates via distiller-update with live progress monitoring
- **E-ink Wallpaper Designer**: Create custom wallpapers for the e-ink display with QR code generation
- **Device Information**: View MAC address, IP address, and device status
- **Project Creation Shortcuts**: Quickly create or navigate to project folders
- **Trial Verification**: Automatic retry mechanism with status polling to ensure trial state is confirmed
- **Update Progress Tracking**: Real-time monitoring of package installation with systemd journal integration

## Requirements

- **Distiller CM5 Device**: This extension is designed specifically for the Distiller CM5 hardware platform
- **Python SDK**: Distiller CM5 SDK installed at `/opt/distiller-cm5-sdk/`
- **distiller-update**: System update utility for checking and installing packages
- **Permissions**: Sudo access may be required for e-ink display operations

## Installation

Install from Open VSX:

1. Open Code-Server on your Distiller CM5
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Device Manager"
4. Click Install

Alternatively, install the `.vsix` file manually:

```bash
code-server --install-extension device-manager-1.0.0.vsix
```

## Usage

### Accessing Device Manager

Open the Device Manager view from the activity bar. The welcome dashboard displays:
- Trial status (active/inactive)
- Device information (MAC, IP)
- Quick action buttons
- Update status (if checked)

### Trial Management

#### Starting a Trial
1. Click "Start Trial" button in the dashboard
2. The extension executes `distiller-update trial start`
3. Status is verified with automatic retry (up to 6 attempts, 5 second intervals)
4. Dashboard updates to show trial active state

#### Stopping a Trial
1. Click "Stop Trial" button in the dashboard
2. The extension executes `distiller-update trial stop`
3. Status is verified with automatic retry
4. Dashboard updates to show trial inactive state

#### Manual Status Check
Click the "Check Status" button to refresh trial status without starting/stopping.

### System Updates

#### Checking for Updates
1. Click "Check for Updates" in the dashboard
2. The extension queries `distiller-update --list --json`
3. Available updates are displayed with:
   - Package name
   - Current version
   - New version
   - Update type (security, major, minor)

#### Installing Updates
1. After checking for updates, click "Install Updates"
2. The extension:
   - Executes `distiller-update --upgrade --yes`
   - Monitors installation progress via systemd journal
   - Displays live progress for each package
   - Shows completion status

#### Update Progress Monitoring
- Real-time package installation tracking
- Progress bar with remaining package count
- Live log output from installation process
- Automatic refresh every 2 seconds during installation

### E-ink Wallpaper Designer

#### Opening the Designer
- Click "Open E-ink Wallpaper Designer" in the dashboard
- Or use Command Palette: `Open E-ink Wallpaper Designer`

#### Designer Features
- Text input with customizable font size, weight, and alignment
- QR code generation with size and position controls
- Live preview of wallpaper design
- One-click deployment to e-ink display
- Support for multiple e-ink firmware types (EPD128x250, EPD240x416)

#### Deploying a Wallpaper
1. Design your wallpaper using text and QR code controls
2. Click "Deploy to E-ink" button
3. The extension:
   - Generates PNG with text and QR code
   - Converts to 1-bit monochrome format
   - Deploys to e-ink display via Python SDK
   - Displays success/failure status

### Project Management

#### Creating a Project
1. Click "Create New Project" in the dashboard
2. Enter project name when prompted
3. Project folder is created under `~/projects/`
4. Folder opens in a new browser tab

#### Navigating to Existing Project
1. Click "Navigate to Existing Project"
2. Browse to project folder
3. Folder opens in a new browser tab

## Configuration

This extension contributes the following settings:

### `pamir.eink.pythonPath`
- **Type**: `string`
- **Default**: `/opt/distiller-cm5-sdk/.venv/bin/python`
- **Description**: Python interpreter with SDK access (uses SDK venv by default)

### `pamir.eink.tunnelUrl`
- **Type**: `string`
- **Default**: `http://localhost:8080`
- **Description**: Tunnel URL that will be encoded in QR codes (e.g., your public tunnel URL or local IP)

### `pamir.eink.timeoutMs`
- **Type**: `number`
- **Default**: `30000`
- **Description**: Subprocess timeout in milliseconds for display operations

### `pamir.eink.debugMode`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Keep temporary files for debugging (normally cleaned up automatically)

## Architecture

### Trial Management
- Uses `distiller-update` CLI for trial control
- Polling-based verification with configurable retry attempts
- Reads trial status from environment variable and settings file
- Automatic UI refresh on status change

### Update System
- Integrates with `distiller-update` package manager
- JSON-based communication for structured data
- Systemd journal monitoring for live progress
- Package tracking with completion state

### E-ink Integration
- Python SDK subprocess execution
- PIL/Pillow for image generation
- QR code generation via qrcode library
- Image processing pipeline: RGB → monochrome → 1-bit
- Support for multiple display firmware types

## Known Limitations

- **Platform-Specific**: Only works on Distiller CM5 devices with proper SDK installation
- **Trial Verification**: May take up to 30 seconds (6 retries × 5 seconds) to confirm trial state
- **Update Monitoring**: Requires systemd journal access for live progress
- **E-ink Timeout**: Complex operations may timeout (configurable via settings)
- **Sudo Requirement**: E-ink operations may require sudo access depending on system configuration

## Troubleshooting

### Trial Not Starting/Stopping
- Verify `distiller-update` is installed: `which distiller-update`
- Check trial status manually: `distiller-update trial status`
- Review extension output channel for errors
- Ensure proper permissions for trial control

### Updates Not Showing
- Run `distiller-update --list` manually to verify availability
- Check network connectivity
- Verify package repositories are configured

### E-ink Designer Not Working
- Verify Python SDK path: `ls /opt/distiller-cm5-sdk/.venv/bin/python`
- Test SDK import: `python3 -c "from distiller_cm5_sdk.hardware.eink import Display"`
- Check for permission errors in output channel
- Try increasing timeout via settings if operations fail

### Device Information Not Displaying
- MAC address detection uses `ip link show`
- IP address detection uses `hostname -I`
- Verify these commands work in terminal

## Privacy

This extension operates entirely on the local device. System update queries may contact package repositories, but no personal data is transmitted.

## License

Apache-2.0

## Repository

https://github.com/Pamir-AI/VS-Code-Extensions

## Issues

Report bugs at: https://github.com/Pamir-AI/VS-Code-Extensions/issues
