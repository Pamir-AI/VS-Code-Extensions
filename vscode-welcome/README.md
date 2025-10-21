# Pamir Welcome & Layout

Custom welcome page and onboarding experience for Distiller CM5 development environment.

## What is Pamir Welcome?

Pamir Welcome provides a custom landing page for VS Code and Code-Server installations on the Distiller CM5 platform. It displays a markdown-rendered welcome page with quick actions for getting started with Distiller development.

## Features

- **Custom Welcome Page**: Markdown-rendered welcome content with Pamir/Distiller branding
- **Quick Actions**: One-click commands to create projects, clone examples, and open documentation
- **Terminal Auto-Show**: Ensures terminal is visible on startup for immediate CLI access
- **Customizable Content**: Support for workspace-specific or extension-bundled markdown content
- **Auto-Launch**: Opens automatically on first activation
- **Embedded Images**: Inline image support via data URIs for maximum compatibility across desktop VS Code and code-server

## Installation

Install from Open VSX:

1. Open VS Code or Code-Server
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Pamir Welcome"
4. Click Install

Alternatively, install the `.vsix` file manually:

```bash
code --install-extension pamir-welcome-1.0.0.vsix
```

## Usage

### Opening the Welcome Page

The welcome page opens automatically on first activation. To open it manually:

- Command Palette (Ctrl+Shift+P): `Pamir: Open Welcome`
- Or from the Explorer view welcome message

### Available Commands

#### Pamir: Open Welcome
Opens the custom welcome page in a webview panel.

#### Create Distiller Project
Creates a new project folder with starter files (`main.py`, `README.md`) in the current workspace.

#### Clone Pamir Examples
Launches the git clone dialog for the Pamir examples repository: `https://github.com/pamir-ai/distiller-examples.git`

#### Open Pamir Docs
Opens the Pamir documentation website in your default browser: `https://docs.pamir.ai/distiller-cm5`

## Customization

### Custom Welcome Content

The extension looks for `quick_start.md` in the following locations (in order):

1. **Workspace media folder**: `<workspace-root>/media/quick_start.md`
2. **Extension media folder**: `<extension-install-path>/media/quick_start.md`

To customize the welcome page:

1. Create a `media/` folder in your workspace root
2. Add your custom `quick_start.md` file
3. Reopen the welcome page to see your changes

### Supported Markdown Features

- GitHub Flavored Markdown (GFM)
- Headings, lists, code blocks
- Blockquotes, horizontal rules
- Inline code and links
- Images (local or remote)
- Tables (via GFM)

### Image Handling

Local images in the markdown are automatically:
- Inlined as data URIs for maximum compatibility
- Resolved relative to the media folder
- Fallback to webview URIs if inlining fails

Supported image formats: PNG, JPG, GIF, SVG

## Configuration

This extension has no user-configurable settings. All behavior is automatic.

## Architecture

- **Extension Activation**: Runs on `onStartupFinished`
- **Markdown Rendering**: Uses `marked` library with GFM support
- **Webview Security**: Content Security Policy (CSP) enabled with safe script nonces
- **Resource Loading**: Supports both workspace and extension resource roots
- **Terminal Management**: Creates or shows existing terminal on startup

## Requirements

- VS Code or Code-Server version ^1.90.0 or higher
- No external dependencies required

## Known Limitations

- Welcome page only opens automatically once (uses global state tracking)
- Project creation requires an open workspace folder
- Git clone command opens VS Code's native git dialog
- Image inlining may fail for very large images

## Troubleshooting

### Welcome Page Not Opening
- Manually open via Command Palette: `Pamir: Open Welcome`
- Check console for errors: Help > Toggle Developer Tools

### Custom Content Not Loading
- Verify `media/quick_start.md` exists in workspace root
- Check file permissions (must be readable)
- Reload window: Developer: Reload Window

### Images Not Displaying
- Verify images are in `media/` folder
- Use relative paths in markdown: `![alt](image.png)` not `![alt](/media/image.png)`
- Check supported formats: PNG, JPG, GIF, SVG

### Commands Not Working
- Verify commands are executed from the welcome page webview
- Check if workspace folder is open (required for project creation)
- Review VS Code command palette for command availability

## Privacy

This extension does not collect or transmit any user data. All operations are local except for opening external documentation links.

## License

Apache-2.0

## Repository

https://github.com/Pamir-AI/VS-Code-Extensions

## Issues

Report bugs at: https://github.com/Pamir-AI/VS-Code-Extensions/issues
