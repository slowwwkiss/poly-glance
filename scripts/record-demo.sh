#!/bin/bash
# Records the demo video: X11 capture of the simulator while the automation
# API drives the flow. Output: docs/demo.mp4 (glasses panel, 1300x720).
set -u
cd ~/workspace/headsup-even-g2
API=http://localhost:9898/api
mkdir -p docs
tap()  { curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"click"}' "$API/input" >/dev/null; sleep 6; }
dbl()  { curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"double_click"}' "$API/input" >/dev/null; sleep 5; }
down() { for i in $(seq 1 "$1"); do curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"down"}' "$API/input" >/dev/null; sleep 0.3; done; sleep 1; }
shot() { curl -s -m 5 -o "docs/screenshots/$1" "$API/screenshot/glasses"; }

COUNT=$(curl -s -m 15 "https://gamma-api.polymarket.com/events?tag_slug=crypto&active=true&closed=false&limit=12&order=volume24hr&ascending=false" | python3 -c "
import json,sys
ev=json.load(sys.stdin); ids=[]
for e in ev:
    for m in e.get('markets',[]):
        if m.get('id') not in ids: ids.append(m.get('id'))
print(min(len(ids),12))")
echo "markets: $COUNT"

pkill -f "evenhub-simulator" 2>/dev/null; sleep 1
DISPLAY=:99 evenhub-simulator --automation-port 9898 "http://localhost:5173/?reset=1" >/tmp/sim.log 2>&1 &
sleep 9
mkdir -p docs/screenshots
shot home.png; python3 scripts/glasses-to-viewable.py docs/screenshots/home.png

ffmpeg -y -v error -f x11grab -video_size 1280x800 -framerate 15 -i :99 -an /tmp/demo-full.mkv &
FFPID=$!
sleep 2
# 0:00-0:12 home (hold)
sleep 8
# 0:12-0:40 detail
tap; shot detail.png
# 0:40-1:15 bet $10 -> confirm
tap; shot confirm.png
# back to detail, then home
tap; dbl
# 1:15-1:45 paper bets
down $((COUNT+1)); tap; shot bets.png; sleep 4
dbl
# 1:45-2:20 voice listening
curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"long_press"}' "$API/input" >/dev/null
sleep 3; shot listening.png; sleep 4
curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"long_press_release"}' "$API/input" >/dev/null
sleep 5
# 2:20-2:45 refresh: go to REFRESH ODDS (last item)
down $((COUNT+2)); tap; sleep 6
kill -INT $FFPID; wait $FFPID 2>/dev/null
sleep 1
for f in detail confirm bets listening; do python3 scripts/glasses-to-viewable.py "docs/screenshots/$f.png"; done
ffmpeg -y -v error -i /tmp/demo-full.mkv -vf "crop=650:360:630:0,scale=1300:720" -c:v libx264 -pix_fmt yuv420p -r 15 docs/demo.mp4
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 docs/demo.mp4
ls -la docs/ docs/screenshots/
