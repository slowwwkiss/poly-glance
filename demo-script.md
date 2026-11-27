# Demo video script — Poly Glance (max 3:00)

Narration is English (DoraHacks judges). Record the simulator's glasses
panel only (see `scripts/record-demo.sh`). Dub the narration over the
silent capture afterwards, or record live while driving the automation API.

## Script (actual timing of `docs/demo.mp4`, 84 s, silent capture)

| Time | On screen (glasses canvas) | Narration |
|---|---|---|
| 0:00–0:10 | Home list, live odds | "Prediction markets move fast. Checking odds means pulling out your phone, opening an app, and digging through menus. Poly Glance puts live Polymarket crypto odds on your glasses — one glance, zero friction." |
| 0:10–0:16 | Tap → Detail | "Tap to open a market. Both sides, volume, end date." |
| 0:16–0:22 | Tap BET Yes $10 → Confirm | "I think Yes is under-priced — ten dollars of play money on Yes at 61 percent. That's a paper bet: no wallet, no real money, ever. Balance drops from 1000 to 990." |
| 0:22–0:32 | Tap → Detail → double-tap → Home | "Back to the list." |
| 0:32–0:43 | Scroll to PAPER BETS → Bets list | "My paper bets track live value — this one is still worth ten dollars. The watchlist keeps the markets I care about one tap away." |
| 0:43–0:55 | Double-tap → Home → long-press → Listening | "Hands full? Long-press and talk. Top. Watchlist. Bets. Refresh. Voice commands do everything taps do — the mic is the G2's own four-mic array." |
| 0:55–1:11 | Release → Home, scroll to REFRESH ODDS | "Odds refresh live — the list re-sorted while we watched, and the clock ticked to 01:52." |
| 1:11–1:24 | Home after refresh | "Everything is read-only and simulated: public data in, no funds out. Poly Glance — Polymarket odds at a glance. Track 02, Crypto and DeFi. Built on Even Hub for G2." |

## Storyboard (frames = verified simulator captures)

1. **Home** — `docs/screenshots/home-view.png` — 12 live crypto markets, first item highlighted.
2. **Detail** — `docs/screenshots/detail-view.png` — question, Yes/No odds, volume, end date, bet actions.
3. **Confirm** — `docs/screenshots/confirm-view.png` — paper-bet receipt, balance $990.
4. **Paper bets** — `docs/screenshots/bets-view.png` — open bet with live paper value.
5. **Listening** — `docs/screenshots/listening-view.png` — voice overlay (honest ASR note).

(`*-view.png` = the same capture converted from the simulator's alpha-channel
PNG to viewable green-on-black. The raw `*.png` files are the simulator-native
captures; convert with `scripts/glasses-to-viewable.py`.)

## How to record (if re-recording)

```bash
./scripts/record-demo.sh
# 1. relaunches the simulator at http://localhost:5173/?reset=1 (clean $1000)
# 2. records the X display (:99, 1280x800) with ffmpeg x11grab
# 3. drives the flow via the automation API (click / double_click / down / long_press)
# 4. crops to the glasses panel and encodes docs/demo.mp4 (H.264)
```

Manual alternative: start the simulator, run
`ffmpeg -f x11grab -video_size 1280x800 -framerate 15 -i :99 demo-full.mkv`,
drive the app with `curl -X POST localhost:9898/api/input -d '{"action":"click"}'`,
then stop ffmpeg (q) and crop: `ffmpeg -i demo-full.mkv -vf "crop=650:360:630:0,scale=1300:720" docs/demo.mp4`.
