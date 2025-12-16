# Change Log

All notable changes to the "pamir-welcome" extension will be documented in this file.

## [1.1.0] - 2025-12-15

### Added
- Platform version detection to show upgrade notice for users on Platform < 2.0
- New upgrade.md page with instructions for upgrading via Device Manager

### Changed
- Updated quick_start.md with Distiller Watchdog self-healing tool
- Added secure local network access (HTTPS) instructions
- Simplified password change section
- Replaced SDK code examples with built-in Claude Skills section
- Removed deprecated Codex and Cursor Agent sections

## [1.0.3] - 2025-11-07

### Added
- **New Extensions Section**: Introduced Distiller Port Manager and Distiller Messaging extensions in quickstart guide
- **Example Agents**: Added information about personal-dashboard and git-glowUp-agent example projects
- Documentation for accessing examples via Session Manager's "Navigate Projects" button
- Improved content organization and readability throughout quickstart guide

## [1.0.2] - 2025-11-01

### Added
- **HTTPS Setup Instructions**: Added new section in quickstart guide explaining how to enable HTTPS access over local network
- Documentation for self-signed certificate installation via `https://<device-accesspoint>/distiller/https/`
- OS-specific automatic certificate setup guidance
- Security note about local network requirement for HTTPS feature

## [1.0.1] - 2025-10-17

### Fixed
- Corrected repository URL to use proper GitHub organization casing (Pamir-AI/VS-Code-Extensions)

## [1.0.0] - 2025-10-17

### Release
- **Open VSX Marketplace Release**: First stable release published to Open VSX marketplace
- **Apache 2.0 License**: Project licensed under Apache License 2.0
- **Repository Metadata**: Added repository, bugs, and homepage URLs
- **Comprehensive Documentation**: Professional README with installation, usage, and customization guides

### Highlights
- Custom welcome page with markdown rendering
- Quick actions for project creation and examples
- Workspace-specific content support
- Automatic terminal visibility
- Inline image support for maximum compatibility

## [0.5.1] - Prior Release

### Features
- Custom Pamir landing page with markdown rendering
- Commands for creating projects, cloning examples, and opening docs
- Ensures terminal visible on startup
- Auto-opens on first activation
- Support for both workspace and extension media folders

### Implementation
- Uses marked library for markdown rendering
- Webview with CSP security
- Image inlining via data URIs
- Fallback to webview URIs for large images
