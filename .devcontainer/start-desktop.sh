#!/usr/bin/env bash
set -euo pipefail

if ! pgrep -f "Xvfb :1" >/dev/null; then
  Xvfb :1 -screen 0 1440x900x24 -ac >/tmp/gmgn-xvfb.log 2>&1 &
fi
export DISPLAY=:1
sleep 2

if ! pgrep -x openbox >/dev/null; then
  openbox >/tmp/gmgn-openbox.log 2>&1 &
fi
if ! pgrep -f "x11vnc.*5900" >/dev/null; then
  x11vnc -display :1 -forever -shared -nopw -rfbport 5900 >/tmp/gmgn-vnc.log 2>&1 &
fi
if ! pgrep -f "websockify.*6080" >/dev/null; then
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/gmgn-novnc.log 2>&1 &
fi
if ! pgrep -f "google-chrome.*gmgn.ai" >/dev/null; then
  google-chrome --no-sandbox --disable-dev-shm-usage --disable-gpu \
    --user-data-dir=/tmp/gmgn-chrome-profile https://gmgn.ai >/tmp/gmgn-chrome.log 2>&1 &
fi

echo "GMGN remote desktop is starting on port 6080."
