#!/bin/bash
# Desktop shortcut for the curator to restart the Rubato installation.
# Double-click to restart the server and relaunch Chrome.
cd ~/Projects/rubato && bash scripts/service.sh restart
echo "Rubato restarted. You can close this window."
