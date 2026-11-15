# C0VIBE patch debt (fork B-EtterDigital/C0Videohub, branch c0/main)

Every line we change inside an upstream file. Only allowed to go down. Our own code lives in new files
(`server/c0-hosted.js`, `server/c0-hosted.test.js`). Design: C0X `docs/sow/videohub/SEAMS.md`.

| File | Lines | Why | Offered upstream |
|---|---|---|---|
| `server/hub.js` | 4 | import hosted mode; token check beside `foreign()`; locked keys on `POST /api/config`; listen on `VIDEOHUB_SOCKET` | not yet (planned as one "hosted mode" PR) |
| `server/jobs.js` | 5 | render env filter; command jobs refused when hosted (and need approval if reached); copy folder inside outputs; render script inside the film folder | not yet |

Total: 9 lines in 2 files (2026-11-15). Hosted mode also refuses to start without its socket (in `server/c0-hosted.js`, no upstream line).

Known upstream test failure, not ours: `scripts/windows-safety.test.js:29` expects `open.vbs` and `open.ps1` to be
gone, but upstream `2302ba8` still ships both. Our payload does not ship the launchers.
