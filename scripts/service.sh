#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"

# Install a plist template: substitute __HOME__ with actual $HOME, copy to LaunchAgents
install_plist() {
    local name="$1"
    local src="$SCRIPT_DIR/$name"
    local dest="$HOME/Library/LaunchAgents/$name"
    local label="${name%.plist}"
    local target="gui/$(id -u)/$label"

    # Stop if already running
    launchctl bootout "$target" 2>/dev/null || true
    sleep 1

    # Substitute __HOME__ placeholder and install
    sed "s|__HOME__|$HOME|g" "$src" > "$dest"

    # Bootstrap (start)
    launchctl bootstrap "gui/$(id -u)" "$dest"
    echo "  $label installed and started"
}

uninstall_plist() {
    local name="$1"
    local dest="$HOME/Library/LaunchAgents/$name"
    local label="${name%.plist}"
    local target="gui/$(id -u)/$label"

    launchctl bootout "$target" 2>/dev/null || true
    rm -f "$dest"
    echo "  $label stopped and removed"
}

status_plist() {
    local name="$1"
    local label="${name%.plist}"
    local target="gui/$(id -u)/$label"

    launchctl print "$target" 2>&1 | head -5 || echo "  $label: not running"
}

SERVER_PLIST="com.rubato.server.plist"
KIOSK_PLIST="com.rubato.kiosk.plist"

case "${1:-}" in
    install)
        echo "Installing rubato services..."
        install_plist "$SERVER_PLIST"
        install_plist "$KIOSK_PLIST"
        ;;
    uninstall)
        echo "Uninstalling rubato services..."
        uninstall_plist "$KIOSK_PLIST"
        uninstall_plist "$SERVER_PLIST"
        ;;
    start)
        launchctl kickstart "gui/$(id -u)/com.rubato.server"
        launchctl kickstart "gui/$(id -u)/com.rubato.kiosk"
        echo "Services started"
        ;;
    stop)
        launchctl bootout "gui/$(id -u)/com.rubato.kiosk" 2>/dev/null || true
        launchctl bootout "gui/$(id -u)/com.rubato.server" 2>/dev/null || true
        echo "Services stopped"
        ;;
    restart)
        "$0" stop
        sleep 2
        "$0" start
        ;;
    status)
        echo "Server:"
        status_plist "$SERVER_PLIST"
        echo ""
        echo "Kiosk:"
        status_plist "$KIOSK_PLIST"
        ;;
    *)
        echo "Usage: $0 {install|uninstall|start|stop|restart|status}"
        exit 1
        ;;
esac
