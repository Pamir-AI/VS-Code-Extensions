# Default recipe - show available commands
default:
	@just --list

# Install dependencies for all extensions
setup:
	@echo "Installing dependencies for all extensions..."
	cd session-manager && npm install
	cd vscode-welcome && npm install
	cd claude-onboard && npm install
	@echo "✓ All dependencies installed"

# Build all extensions
build: setup
	@echo "Building all extensions..."
	@just build-session-manager
	@just build-vscode-welcome
	@just build-claude-onboard
	@echo "✓ All extensions built"

# Build individual extensions
build-session-manager:
	@echo "Building session-manager..."
	cd session-manager && npm run package
	cd session-manager && npx @vscode/vsce package
	@echo "✓ session-manager built"

build-vscode-welcome:
	@echo "Building vscode-welcome..."
	cd vscode-welcome && npm run package
	cd vscode-welcome && npx @vscode/vsce package
	@echo "✓ vscode-welcome built"

build-claude-onboard:
	@echo "Building claude-onboard..."
	cd claude-onboard && npm run package
	cd claude-onboard && npx @vscode/vsce package
	@echo "✓ claude-onboard built"

# Clean all build artifacts and node_modules
clean:
	@echo "Cleaning build artifacts..."
	rm -f session-manager/*.vsix
	rm -f vscode-welcome/*.vsix
	rm -f claude-onboard/*.vsix
	cd session-manager && rm -rf node_modules dist out
	cd vscode-welcome && rm -rf node_modules dist out
	cd claude-onboard && rm -rf node_modules dist out
	@echo "✓ Cleaned"

# Publish all extensions to OpenVSX (requires OVSX_TOKEN env var)
publish: build
	@echo "Publishing extensions to OpenVSX..."
	@if [ -z "$$OVSX_TOKEN" ]; then \
		echo "ERROR: OVSX_TOKEN environment variable not set"; \
		exit 1; \
	fi
	cd session-manager && npx ovsx publish *.vsix -p $$OVSX_TOKEN
	cd vscode-welcome && npx ovsx publish *.vsix -p $$OVSX_TOKEN
	cd claude-onboard && npx ovsx publish *.vsix -p $$OVSX_TOKEN
	@echo "✓ All extensions published"

# Publish individual extensions
publish-session-manager: build-session-manager
	cd session-manager && npx ovsx publish *.vsix -p $$OVSX_TOKEN

publish-vscode-welcome: build-vscode-welcome
	cd vscode-welcome && npx ovsx publish *.vsix -p $$OVSX_TOKEN

publish-claude-onboard: build-claude-onboard
	cd claude-onboard && npx ovsx publish *.vsix -p $$OVSX_TOKEN

# Lint all extensions
lint:
	cd session-manager && npm run lint
	cd vscode-welcome && npm run lint
	cd claude-onboard && npm run lint

# Type check all extensions
check-types:
	cd session-manager && npm run check-types
	cd vscode-welcome && npm run check-types
	cd claude-onboard && npm run check-types
