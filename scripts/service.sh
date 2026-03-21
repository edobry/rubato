#!/bin/bash
set -euo pipefail

PLIST_NAME="com.rubato.server.plist"
PLIST_SRC="$(dirname "$0")/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
SERVICE_TARGET="gui/$(id -u)/com.rubato.server"

case "${1:-}" in
    install)
        cp "$PLIST_SRC" "$PLIST_DEST"
        launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
        echo "Service installed and started"
        ;;
    start)
        launchctl kickstart "$SERVICE_TARGET"
        echo "Service started"
        ;;
    stop)
        launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
        echo "Service stopped"
        ;;
    restart)
        launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
        sleep 1
        launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
        echo "Service restarted"
        ;;
    status)
        launchctl print "$SERVICE_TARGET" 2>/dev/null || echo "Service not running"
        ;;
    *)
        echo "Usage: $0 {install|start|stop|restart|status}"
        exit 1
        ;;
esac
