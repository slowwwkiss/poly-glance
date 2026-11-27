#!/bin/bash
# Test harness: Xvfb + vite dev + Even Hub simulator (automation port 9898)
set -u
cd ~/workspace/headsup-even-g2
mkdir -p test-shots
pkill -f "Xvfb :99" 2>/dev/null; pkill -f "evenhub-simulator" 2>/dev/null; pkill -f "vite" 2>/dev/null
sleep 1
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 2
DISPLAY=:99 npm run dev >/tmp/vite.log 2>&1 &
for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:5173/ && break; sleep 1; done
echo "vite up: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/)"
DISPLAY=:99 evenhub-simulator --automation-port 9898 http://localhost:5173 >/tmp/sim.log 2>&1 &
sleep 6
echo "--- sim log ---"; tail -5 /tmp/sim.log
echo "--- automation probe ---"
for p in / /health /docs /openapi.json /api /screenshot /state; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost:9898$p")
  echo "$p -> $code"
done
ffmpeg -y -v error -f x11grab -video_size 1280x800 -i :99 -frames:v 1 test-shots/shot1-home.png
ls -la test-shots/
