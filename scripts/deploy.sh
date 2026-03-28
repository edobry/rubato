#!/usr/bin/env bash
set -euo pipefail

REF="${1:-origin/master}"
HOST="rubato-mini"
REMOTE_DIR="~/Projects/rubato"

echo "Deploying rubato @ ${REF} to ${HOST}..."

ssh "$HOST" bash -s "$REF" <<'REMOTE_SCRIPT'
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"

# If deployment fails mid-way, try to restart services so the gallery isn't left dead
trap 'echo "ERROR: Deploy failed, attempting to restart services..."; bash scripts/service.sh install 2>/dev/null || true' ERR

REF="$1"
cd ~/Projects/rubato

# Stop existing services and Chrome
echo "Stopping services..."
bash scripts/service.sh stop 2>/dev/null || true
echo "Stopping Chrome..."
pkill -f "Google Chrome" 2>/dev/null || true
sleep 2
# Force-kill Chrome if still running
if pgrep -f "Google Chrome" &>/dev/null; then
    pkill -9 -f "Google Chrome" 2>/dev/null || true
    sleep 1
fi
# Kill ALL vite processes to ensure clean restart
echo "Stopping existing server..."
pkill -f vite 2>/dev/null || true
sleep 1
# Force-kill if still hanging
if lsof -i :5173 -t &>/dev/null; then
    echo "Force-killing lingering processes..."
    pkill -9 -f vite 2>/dev/null || true
    sleep 1
fi

echo "Fetching latest from origin..."
git fetch origin

echo "Checking out $REF..."
git stash --quiet 2>/dev/null || true
git checkout "$REF" --

echo "Installing dependencies..."
npm install --no-audit --no-fund

echo "Truncating old logs..."
: > ~/rubato-stdout.log 2>/dev/null || true
: > ~/rubato-stderr.log 2>/dev/null || true
: > ~/rubato-kiosk.log 2>/dev/null || true

echo "Installing services..."
bash scripts/service.sh install

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
