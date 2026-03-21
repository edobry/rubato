#!/usr/bin/env bash
set -euo pipefail

REF="${1:-origin/master}"
HOST="rubato-mini"
REMOTE_DIR="~/Projects/rubato"

echo "Deploying rubato @ ${REF} to ${HOST}..."

# Copy custom presets to Mac Mini (not git-tracked)
PRESETS_FILE="$(dirname "$0")/../custom-presets.json"
if [ -f "$PRESETS_FILE" ]; then
    echo "Syncing custom presets..."
    scp -q "$PRESETS_FILE" "${HOST}:${REMOTE_DIR}/custom-presets.json"
fi

ssh "$HOST" bash -s "$REF" <<'REMOTE_SCRIPT'
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"

REF="$1"
cd ~/Projects/rubato

PLIST_NAME="com.rubato.server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
SERVICE_TARGET="gui/$(id -u)/com.rubato.server"

# Stop existing service (launchd or legacy process)
echo "Stopping existing server..."
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true

# Fallback: kill any lingering process on port 5173
EXISTING_PID=$(lsof -i :5173 -t 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    echo "Killing lingering process on :5173 (PID $EXISTING_PID)..."
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 2
    if lsof -i :5173 -t &>/dev/null; then
        kill -9 "$EXISTING_PID" 2>/dev/null || true
    fi
fi

echo "Fetching latest from origin..."
git fetch origin

echo "Checking out $REF..."
git stash --quiet 2>/dev/null || true
git checkout "$REF" --

echo "Installing dependencies..."
npm install --no-audit --no-fund

# Install and start the launchd service
echo "Installing launchd service..."
cp "scripts/$PLIST_NAME" "$PLIST_DEST"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
echo "Service started via launchd"

# Wait and verify
sleep 4
if lsof -i :5173 -t &>/dev/null; then
    echo "Server is running on :5173"
else
    echo "WARNING: Server may not have started. Check ~/rubato-stdout.log"
fi
REMOTE_SCRIPT

echo ""
echo "Deploy complete. Access the app at:"
echo "  https://${HOST}:5173"
