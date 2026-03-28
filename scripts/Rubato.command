#!/bin/bash
# Desktop shortcut for the curator to restart the Rubato installation.
# Double-click to restart the server and relaunch Chrome.
cd ~/Projects/rubato && bash scripts/service.sh restart
# Auto-close this Terminal window
osascript -e 'tell application "Terminal" to close front window' &
exit 0
