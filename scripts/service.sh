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
        # Place a restart shortcut on the Desktop for the curator
        cp "$SCRIPT_DIR/Rubato.command" "$HOME/Desktop/Rubato.command"
        chmod +x "$HOME/Desktop/Rubato.command"
        echo "  Desktop shortcut installed"
        ;;
    uninstall)
        echo "Uninstalling rubato services..."
        uninstall_plist "$KIOSK_PLIST"
        uninstall_plist "$SERVER_PLIST"
        ;;
    start)
        # Bootstrap if not loaded, kickstart if already loaded
        for plist in "$SERVER_PLIST" "$KIOSK_PLIST"; do
            local_label="${plist%.plist}"
            local_target="gui/$(id -u)/$local_label"
            local_dest="$HOME/Library/LaunchAgents/$plist"
            if launchctl print "$local_target" &>/dev/null; then
                launchctl kickstart -k "$local_target"
            else
                launchctl bootstrap "gui/$(id -u)" "$local_dest"
            fi
        done
        echo "Services started"
        ;;
    stop)
        # Kill processes but keep services registered so start/kickstart works
        for plist in "$KIOSK_PLIST" "$SERVER_PLIST"; do
            local_label="${plist%.plist}"
            local_target="gui/$(id -u)/$local_label"
            launchctl kill SIGTERM "$local_target" 2>/dev/null || true
        done
        echo "Services stopped"
        ;;
    restart)
        # Full re-bootstrap: bootout then bootstrap for a clean restart
        for plist in "$KIOSK_PLIST" "$SERVER_PLIST"; do
            local_label="${plist%.plist}"
            local_target="gui/$(id -u)/$local_label"
            launchctl bootout "$local_target" 2>/dev/null || true
        done
        sleep 2
        for plist in "$SERVER_PLIST" "$KIOSK_PLIST"; do
            local_dest="$HOME/Library/LaunchAgents/$plist"
            launchctl bootstrap "gui/$(id -u)" "$local_dest"
        done
        echo "Services restarted"
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
