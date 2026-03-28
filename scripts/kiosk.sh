#!/bin/bash
set -euo pipefail

URL="https://localhost:5173"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

echo "[rubato-kiosk] Waiting for server at $URL..."

# Wait up to 60 seconds for the server to be ready
for i in $(seq 1 60); do
    if curl -sk -o /dev/null "$URL" 2>/dev/null; then
        echo "[rubato-kiosk] Server ready after ${i}s"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo "[rubato-kiosk] ERROR: Server not ready after 60s, launching Chrome anyway"
    fi
    sleep 1
done

echo "[rubato-kiosk] Launching Chrome in kiosk mode..."
exec "$CHROME" \
    --kiosk \
    --start-fullscreen \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --noerrdialogs \
    --disable-translate \
    --no-first-run \
    "$URL"
