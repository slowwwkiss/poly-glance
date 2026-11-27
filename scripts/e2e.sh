#!/bin/bash
# Scripted end-to-end test via simulator automation API (port 9898).
# Steps: home -> detail -> place $10 paper bet -> confirm -> back -> home
#        -> watchlist -> home -> paper bets -> home -> voice listening -> home
set -u
cd ~/workspace/headsup-even-g2
API=http://localhost:9898/api
shot() { curl -s -m 5 -o "test-shots/$1" "$API/screenshot/glasses"; }
tap()  { curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"click"}' "$API/input" >/dev/null; sleep 1; }
dbl()  { curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"double_click"}' "$API/input" >/dev/null; sleep 1; }
down() { for i in $(seq 1 "$1"); do curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"down"}' "$API/input" >/dev/null; sleep 0.3; done; }

# market count (same logic as the app: crypto events, flatten, dedupe, top 12)
COUNT=$(curl -s -m 15 "https://gamma-api.polymarket.com/events?tag_slug=crypto&active=true&closed=false&limit=12&order=volume24hr&ascending=false" | python3 -c "
import json,sys
ev=json.load(sys.stdin); ids=[]
for e in ev:
    for m in e.get('markets',[]):
        if m.get('id') not in ids: ids.append(m.get('id'))
print(min(len(ids),12))")
echo "markets on home: $COUNT"

# fresh simulator (kills the HMR-reloaded one)
pkill -f "evenhub-simulator" 2>/dev/null; sleep 1
DISPLAY=:99 evenhub-simulator --automation-port 9898 http://localhost:5173 >/tmp/sim.log 2>&1 &
sleep 8
shot e2e-01-home.png; echo "01 home done"

tap; shot e2e-02-detail.png; echo "02 detail done"
tap; shot e2e-03-confirm.png; echo "03 confirm (bet placed) done"
tap; shot e2e-04-detail-back.png; echo "04 back to detail done"
dbl; shot e2e-05-home.png; echo "05 back home done"

down "$COUNT"; tap; shot e2e-06-watchlist.png; echo "06 watchlist done (has the market? check shot)"
dbl; sleep 1
down $((COUNT+1)); tap; shot e2e-07-bets.png; echo "07 paper bets done"
dbl; sleep 1

# voice: long-press -> listening screen, then release -> back
curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"long_press"}' "$API/input" >/dev/null
sleep 1; shot e2e-08-listening.png; echo "08 listening done"
curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"action":"long_press_release"}' "$API/input" >/dev/null
sleep 2; shot e2e-09-home-after-voice.png; echo "09 home after voice done"

echo "--- console errors ---"
curl -s -m 5 "$API/console" | python3 -c "
import json,sys
d=json.load(sys.stdin)
errs=[e for e in d['entries'] if e.get('level')=='error']
print('error entries:',len(errs))
for e in errs: print(' *',e.get('message','')[:160])
logs=[e for e in d['entries'] if 'createStartUpPageContainer failed' in e.get('message','')]
print('create-failed count:',len(logs))
"
ls -la test-shots/e2e-*.png
