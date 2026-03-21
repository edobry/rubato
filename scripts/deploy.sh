#!/usr/bin/env bash
set -euo pipefail

REF="${1:-origin/master}"
HOST="rubato-mini"
REMOTE_DIR="~/Projects/rubato"
LOG_FILE="~/rubato.log"
PORT=5173

echo "Deploying rubato @ ${REF} to ${HOST}..."

ssh "$HOST" bash -s "$REF" <<'REMOTE_SCRIPT'
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"

REF="$1"
cd ~/Projects/rubato

# Kill existing dev server on port 5173, if any
EXISTING_PID=$(lsof -i :5173 -t 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    echo "Stopping existing server (PID $EXISTING_PID)..."
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 2
    # Check if it's still running
    if lsof -i :5173 -t &>/dev/null; then
        echo "Server didn't stop gracefully, sending SIGKILL..."
        kill -9 "$EXISTING_PID" 2>/dev/null || true
    fi
fi

echo "Fetching latest from origin..."
git fetch origin

echo "Checking out $REF..."
git checkout "$REF" --

echo "Installing dependencies..."
npm install --no-audit --no-fund

echo "Starting dev server..."
nohup bash -c 'export PATH="$HOME/.local/node/bin:$PATH" && cd ~/Projects/rubato && npm run dev' > ~/rubato.log 2>&1 &
SERVER_PID=$!
echo "Server started (PID $SERVER_PID), logging to ~/rubato.log"

# Wait briefly and verify it's running
sleep 3
if lsof -i :5173 -t &>/dev/null; then
    echo "Server is running."
else
    echo "WARNING: Server may not have started. Check ~/rubato.log"
fi
REMOTE_SCRIPT

echo ""
echo "Deploy complete. Access the app at:"
echo "  https://rubato-mini.local:5173"
