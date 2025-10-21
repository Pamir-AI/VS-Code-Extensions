#!/bin/bash

EXTENSIONS=("session-manager" "vscode-welcome" "claude-onboard")
NAMES=("Happy Session Manager" "Pamir Welcome" "Device Manager")
PKGNAMES=("happy-session-manager" "pamir-welcome" "device-manager")

get_version() {
    local dir=$1
    grep '"version"' "$dir/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/'
}

build_extension() {
    local idx=$1
    local dir=${EXTENSIONS[$idx]}
    local name=${NAMES[$idx]}

    echo "Building $name..."
    cd "$dir"
    npm run package > /dev/null 2>&1 || npm run build > /dev/null 2>&1
    npx @vscode/vsce package > /dev/null 2>&1
    local version=$(get_version ".")
    echo "✓ ${PKGNAMES[$idx]}-${version}.vsix created"
    cd ..
}

publish_extension() {
    local idx=$1
    local dir=${EXTENSIONS[$idx]}
    local name=${NAMES[$idx]}
    local version=$(get_version "$dir")
    local vsix="${PKGNAMES[$idx]}-${version}.vsix"

    if [ -z "$OVSX_TOKEN" ]; then
        echo "Error: OVSX_TOKEN not set"
        return 1
    fi

    echo "Publishing $name..."
    cd "$dir"
    npx ovsx publish "$vsix" -p "$OVSX_TOKEN" > /dev/null 2>&1
    echo "✓ $name published"
    cd ..
}

show_menu() {
    echo ""
    echo "=========================================="
    echo "Extension Manager"
    echo "=========================================="
    echo ""
    echo "1) Happy Session Manager"
    echo "2) Pamir Welcome"
    echo "3) Device Manager"
    echo "4) All Extensions"
    echo "q) Quit"
    echo ""
}

main() {
    cd /home/distiller/projects/VS-Code-Extensions

    while true; do
        show_menu
        read -p "Select extension: " choice

        case $choice in
            q|Q) echo "Bye!"; exit 0 ;;
            1|2|3)
                idx=$((choice-1))
                echo ""
                read -p "Action (b=build, p=publish, bp=both): " action

                case $action in
                    b) build_extension $idx ;;
                    p) publish_extension $idx ;;
                    bp) build_extension $idx && publish_extension $idx ;;
                    *) echo "Invalid action" ;;
                esac
                ;;
            4)
                echo ""
                read -p "Action (b=build, p=publish, bp=both): " action

                case $action in
                    b) for i in 0 1 2; do build_extension $i; done ;;
                    p) for i in 0 1 2; do publish_extension $i; done ;;
                    bp) for i in 0 1 2; do build_extension $i && publish_extension $i; done ;;
                    *) echo "Invalid action" ;;
                esac
                ;;
            *) echo "Invalid choice" ;;
        esac
    done
}

main
