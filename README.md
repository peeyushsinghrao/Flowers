# Grow & Bloom 🌷

A webcam hand-tracking flower experience — grow a stem with your right hand,
bloom it with your left, with pinch-to-pluck, fist-to-wilt, and a two-hand
bouquet mode. Includes photo capture and session recording, both saved
locally and uploaded to Supabase.

## Running it

Browsers block camera/microphone access on pages opened directly as a file
(`file://...`). You must serve this folder over `http://localhost` (or HTTPS).

**Option A — Python:**
```bash
cd grow-and-bloom
python3 -m http.server 8000
```
Then open `http://localhost:8000` in Chrome or Edge.

**Option B — Node (if you have it):**
```bash
npx serve grow-and-bloom
```

**Option C — VS Code:** install the "Live Server" extension, right-click
`index.html` → "Open with Live Server."

## How to use it

- **Right hand** — open your palm to grow the stem. Close it to shrink it back.
- **Left hand** — spread your fingers to bloom the flower.
- **Make a fist** (either hand, held ~1s) — the flower gracefully wilts, so
  you can reset and grow a fresh one.
- **Pinch** (thumb + index finger touching) — plucks a single petal off.
- **Cup both hands together** (~1s) — triggers bonus bouquet mode (three
  flowers). Release to return to a single flower.
- **⚙ Settings** (top-right) — switch camera, choose tulip/rose, toggle
  mirroring, hand-skeleton overlay, and sound.
- **📷 Capture** — saves a photo (camera + flower effects) to your device
  and uploads it to Supabase.
- **● Record** — tap to start recording video+audio. Tap again to stop.
  Recording keeps going if you switch tabs/apps, auto-finalizes if you
  actually close the tab, and uploads in ~10-minute chunks to Supabase as it
  goes. On stop/finalize, the full video also downloads to your device.

## Important limitation: recording and closed tabs

A browser page cannot keep recording after the tab is actually closed —
all JavaScript execution and camera/mic access stops the instant the page
is gone. This is a hard platform boundary in every browser, not a bug here.
What this app does instead:
- Recording **does** continue if you merely switch tabs, minimize, or
  background the browser (page stays open, just not focused).
- If you **close the tab/browser**, the app auto-finalizes whatever was
  captured up to that moment (best-effort — a hard crash/force-quit can't
  be caught by any web API).
- Every ~10 minutes, whatever's recorded so far is uploaded to Supabase as
  its own chunk file, so even a long session isn't lost if something
  interrupts it later.

## Project structure

```
grow-and-bloom/
├── index.html          — page structure
├── style.css            — full design system (colors, type, layout, animation)
├── js/
│   ├── config.js         — Supabase credentials + tunable constants
│   ├── oneEuroFilter.js  — landmark jitter smoothing
│   ├── audio.js          — Web Audio API bloom chime + pluck sound
│   ├── particles.js      — pollen/sparkle drift system
│   ├── flower.js         — bezier-petal flower rendering (tulip/rose)
│   ├── gestures.js        — fist/pinch/cup gesture detection
│   ├── handTracking.js   — MediaPipe Hands wiring + hand metrics
│   ├── capture.js         — photo snapshot: local save + Supabase upload
│   ├── recorder.js        — chunked video+audio recording + upload
│   ├── onboarding.js      — first-run tutorial overlay
│   └── main.js            — app bootstrap, wiring everything together
└── README.md (this file)
```

## Supabase setup (already done for this build)

- Bucket: `flower-sessions` (public)
- Storage policy: `INSERT` allowed for the `anon` role, expression
  `bucket_id = 'flower-sessions'`
- Uploaded paths:
  - Photos: `photos/grow-and-bloom_<timestamp>.png`
  - Videos: `videos/session_<timestamp>/chunk_001.webm`, `chunk_002.webm`, …

If you ever want to browse/download what's been uploaded, the Supabase
dashboard → Storage → `flower-sessions` bucket will list everything.

## Notes on video chunk files

Only the *first* uploaded chunk of a recording session contains full WebM
container headers — later chunks are valid fragments but generally won't
play standalone by double-clicking them. They're still byte-correct and
play back fine when concatenated in order, which is exactly what happens
in the local download you get on Stop. If you want each Supabase chunk to
be independently playable, that requires re-muxing server-side (e.g. with
ffmpeg) — happy to help with that separately if useful.
