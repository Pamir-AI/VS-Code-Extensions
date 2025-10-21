# Change Log

All notable changes to the "pamir-welcome" extension will be documented in this file.

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
