#!/usr/bin/env bash
set -euo pipefail

REF="${1:-origin/master}"
HOST="rubato-mini"
REMOTE_DIR="~/Projects/rubato"

echo "Deploying rubato @ ${REF} to ${HOST}..."

ssh "$HOST" bash -s "$REF" <<'REMOTE_SCRIPT'
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"

REF="$1"
cd ~/Projects/rubato

# Stop existing services and Chrome
echo "Stopping services..."
bash scripts/service.sh stop 2>/dev/null || true
echo "Stopping Chrome..."
pkill -f "Google Chrome" 2>/dev/null || true
sleep 2
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
