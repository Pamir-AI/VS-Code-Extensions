# Change Log

All notable changes to the "device-manager" extension will be documented in this file.

## [1.0.1] - 2025-10-17

### Fixed
- Corrected repository URL to use proper GitHub organization casing (Pamir-AI/VS-Code-Extensions)

## [1.0.0] - 2025-10-17

### Release
- **Open VSX Marketplace Release**: First stable release published to Open VSX marketplace
- **Apache 2.0 License**: Project licensed under Apache License 2.0
- **Repository Metadata**: Added repository, bugs, and homepage URLs
- **Comprehensive Documentation**: Professional README with installation, usage, and troubleshooting guides

### Highlights
- Claude Code trial management with real-time verification
- System update checking and installation via distiller-update
- E-ink wallpaper designer with QR code generation
- Device information display (MAC, IP)
- Project creation and navigation shortcuts
- Trial verification with automatic retry mechanism
- Update progress monitoring with systemd journal integration

## [0.0.8] - Prior Release

### Features
- Trial start/stop functionality
- System update integration
- E-ink wallpaper designer
- Device information dashboard
- Project management shortcuts

## [0.0.6] - 2025-09-17
- Fixed alpha/transparent image processing by adding white background before processing for e-ink display

## [0.0.5] - 2025-09-17
- Fixed black background in e-ink editor to white for better alpha/SVG image visibility

## [0.0.4] - 2025-09-17
- Fixed command name mismatch for e-ink button functionality
- Comprehensive naming consistency updates from claude-onboard to device-manager

## [0.0.3] - 2025-02-10
- Prompt for project folder names before creation
- Open project folders in a new browser tab via `vscode.openFolder(..., true)` for create/navigate flows
- Refreshed onboarding dashboard layout: stacked header, refined status pill, grouped CTAs, and new ASCII device banner
- Improved responsiveness and typography for buttons, chips, and utility sections

## [0.0.2] - 2025-02-10
- Added onboarding buttons to create or navigate project folders under `~/projects`
- Wired project folder creation/opening commands and lint cleanup

## [0.0.1]
- Initial release
