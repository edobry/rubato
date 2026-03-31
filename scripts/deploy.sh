#!/usr/bin/env bash
set -euo pipefail

HOST="rubato-mini"
REMOTE_DIR="~/Projects/rubato"

echo "Building..."
npm run build

echo "Deploying to ${HOST}..."

# Sync built artifacts + server + scripts + configs
rsync -az --delete \
    dist/ "${HOST}:${REMOTE_DIR}/dist/"

rsync -az \
    server/ "${HOST}:${REMOTE_DIR}/server/"

rsync -az \
    scripts/ "${HOST}:${REMOTE_DIR}/scripts/"

rsync -az \
    package.json package-lock.json tsconfig.server.json \
    "${HOST}:${REMOTE_DIR}/"

# Also sync src/ws/ since server imports relay.ts via tsx
rsync -az \
    src/ws/ "${HOST}:${REMOTE_DIR}/src/ws/"

# Install deps + restart on remote
ssh "$HOST" bash <<'REMOTE_SCRIPT'
set -euo pipefail
export PATH="$HOME/.local/node/bin:$PATH"
cd ~/Projects/rubato

echo "Installing dependencies..."
npm install --no-audit --no-fund --production 2>/dev/null || npm install --no-audit --no-fund

echo "Truncating old logs..."
: > ~/rubato-stdout.log 2>/dev/null || true
: > ~/rubato-stderr.log 2>/dev/null || true
: > ~/rubato-kiosk.log 2>/dev/null || true

echo "Restarting services..."
bash scripts/service.sh install

sleep 4
if lsof -i :5173 -t &>/dev/null; then
    echo "Server is running on :5173"
else
    echo "WARNING: Server may not have started. Check ~/rubato-stdout.log"
fi
REMOTE_SCRIPT

echo ""
echo "Deploy complete. Access at:"
echo "  https://${HOST}:5173"
