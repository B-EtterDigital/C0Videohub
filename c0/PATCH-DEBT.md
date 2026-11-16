# C0VIBE patch debt (fork B-EtterDigital/C0Videohub, branch c0/main)

Every line we change inside an upstream file. Only allowed to go down. Our own code lives in new files
(`server/c0-hosted.js`, `server/c0-hosted.test.js`). Design: C0X `docs/sow/videohub/SEAMS.md`.

| File | Lines | Why | Offered upstream |
|---|---|---|---|
| `server/hub.js` | 4 | import hosted mode; token check beside `foreign()`; locked keys on `POST /api/config`; listen on `VIDEOHUB_SOCKET` | not yet (planned as one "hosted mode" PR) |
| `server/jobs.js` | 5 | render env filter; command jobs refused when hosted (and need approval if reached); copy folder inside outputs; render script inside the film folder | not yet |
| `server/live.js` | 11 (7 added, 4 removed) | HyperFrames drafts: detected as live pages (`hasHook`), size/fps/length read from the page (`liveInfo`), adapter tag added to the served page (`serve`); all logic in `server/c0-hyperframes.js` | not yet |
| `server/hub.js` (A-5) | 4 (3 added, 1 removed) | `/media` allows the `c0-hf-mix` folder (one entry in `allowedFile`, nothing else in the data folder); the `live-audio` event is broadcast when a draft's mix is ready; one import | not yet |
| `server/live.js` (A-5) | 9 (6 added, 3 removed) | a HyperFrames page's sound is its own clips, mixed once (`hyperframesSound`), unless `live.audio` is set; `audioName` names the clips; all logic in `server/c0-hyperframes-audio.js` | not yet |
| `ui/review/live.js` (A-5) | 9 (8 added, 1 removed) | `setAudio(url)` makes the audio element when a draft started silent and plays the mix from the same moment; `audio` becomes `let` | not yet |
| `ui/review.js` (A-5) | 4 (3 added, 1 removed) | `live-audio` listener hands the fetched mix to the live source; unsubscribes in the page's destroy | not yet |
| `ui/style.css` | 13 | host theme: chrome colours outside `:root` use the variables; `:root` gets `--teal` (no existing variable for the snap guide and clip selection), dark value from upstream | not yet |
| `ui/review.css` | 41 | host theme for the review screen and timeline: chrome colours become variables or `color-mix` overlays; video stage, thumbnail backings, on-picture captions and shadows stay as they are (content) | not yet |
| `ui/thumbstudio.css` | 13 | host theme for the thumbnail studio: panels, canvas workspace, error card, viewer; feed mock-ups, thumbnail backings and the picture pins stay (content) | not yet |
| `ui/review.js` | 4 | import `c0-theme.js`; the note labels drawn on the frame redraw on `c0:theme`; the page unsubscribes when it closes | not yet |
| `ui/review/timeline.js` | 58 | canvas chrome (ruler, lanes, playhead, guides, overlay, note markers) reads `vhColor`; redraws and clears the waveform cache on `c0:theme`; unsubscribes in `destroy()`. Track, scene and clip identity colours stay (content) | not yet |
| `ui/review/edit2d.js` | 8 | selection outlines and labels read `vhColor`; redraw on `c0:theme` while open; unsubscribes in `destroy()`. Annotation defaults and colour pickers stay (content) | not yet |
| `ui/review/sceneedit.js` | 5 | scene-editor outlines read `vhColor`; redraw on `c0:theme` while open; unsubscribes in `destroy()`. Portal presets stay (content) | not yet |
| `ui/review/autoscan.js` | 13 | scan flag colours are theme names (canvas and DOM both resolve them); canvas chrome reads `vhColor`; repaints on `c0:theme`; unsubscribes in `destroy()` | not yet |

Total: 201 lines in 12 files (2026-11-16; the A-5 rows add 26 lines and `ui/review/live.js` as a 12th file). Hosted mode also refuses to start without its socket (in `server/c0-hosted.js`, no upstream line).
The host theme bridge is ours and lives in new files: `ui/c0-theme.js` and `ui/c0-theme.test.js` (no upstream line).
The HyperFrames adapter is ours: `server/c0-hyperframes.js`, `ui/c0-hyperframes.js` and their tests (no upstream line).
The HyperFrames draft sound is ours: `server/c0-hyperframes-audio.js` and `server/c0-hyperframes-audio.test.js` (no upstream line).

Known upstream test failure, not ours: `scripts/windows-safety.test.js:29` expects `open.vbs` and `open.ps1` to be
gone, but upstream `2302ba8` still ships both. Our payload does not ship the launchers.
