# Change Log

All notable changes to the "claude-onboard" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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
