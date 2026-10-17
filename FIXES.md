# Review Fixes Plan

Fixes from the October 2026 project review. Numbers (`#N`) match the review list.
Out of scope for now: #14 (admin role / registration / soundboard ownership — needs a
design decision) and #22 (test suite + CI checks).

**Workflow**: one slice per branch (`fix/NN-name`), each branch stacked on the previous
slice's branch — `main` stays untouched until the end. After each slice is pushed the
user does a quick build check on the dev server (catches compile errors early; nothing is
compiled on this machine). Functional testing happens once at the end, on the last
branch, using the test steps listed per slice; then the chain is merged into `main`.
No local builds (this machine has no Node). Every slice adds notes under `## Unreleased`
in CHANGELOG.md; server-only slices need no version bump. For slices that touch
`packages/ui` or `apps/desktop`, desktop test builds come from a `workflow_dispatch` run
on the branch (artifacts only, no release); the version bump + `v*` tag happen after
merge so unmerged code never auto-updates clients.

---

## Slice 1 — Moderation & room bookkeeping (`fix/01-moderation`) — server only

- [x] **#1** `punishment:started` no longer carries the jail LiveKit token/E2EE key to
      everyone: other users get the punishment details, only the target's own
      connections get `jailConnection` (`sendToUser` / `broadcastExceptUser` in events.ts).
- [x] **#7** `restoreTimers()` compared SQLite `YYYY-MM-DD HH:MM:SS` text against a JS
      ISO string, so every same-day vote/punishment was treated as expired and silently
      cancelled on API restart. Now parses the SQLite timestamp properly; punishments
      that genuinely expired while down go through `expirePunishment()` (broadcasts).
- [x] **#8** Deleting a room with any vote/punishment/whisper history hit a foreign-key
      error (500). Delete now cascades history rows and the room's jail room in one
      transaction, and refuses (409) while a vote or punishment is active.
- [x] **#12** Switching rooms via `/join` or `/sync` (and being jailed) didn't remove
      the user from the old room's whisper chain. All room-leave paths now share
      `broadcastRoomLeave()` (presence.ts).
- [x] Pushed. End-pass tests (one person can do these with 3 accounts in separate
      browser profiles, mics muted):
  - 3 users in a room, vote one into jail → only the jailed user's browser moves to the
    jail room; others see the jail notice; DevTools → Network → `/api/events` stream on a
    non-target shows no `jailConnection`.
  - Jail someone for 5 min, `docker compose restart api`, punishment still active after
    restart (`/api/punishments/active` for the target, or the creator's lift button).
  - Create a room, run a vote in it (pass or fail), then delete it → succeeds, its
    `Jail: …` room disappears too. Deleting during an active vote/jail → refused.
  - Whispers mode with 3 people; one user clicks into another room → chain shrinks.

## Slice 2 — Music bot lockdown (`fix/02-music-bot`)

- [x] **#2** Every bot endpoint except `/health` requires the internal key (one aiohttp
      middleware instead of per-route checks).
- [x] **#3** Internal key is no longer `LIVEKIT_API_KEY` (leaked as the `iss` of every
      client LiveKit token). Derived on both sides as
      `HMAC-SHA256(LIVEKIT_API_SECRET, "distokoloshe-internal")` — no new env var, the
      secret never leaves the server. Constant-time compare. API and bot must be
      rebuilt together.
- [x] **#18** Bot rejects queue URLs (and yt-dlp-resolved stream URLs) whose host
      resolves to a non-public address. Residual: DNS rebinding and HLS segment URLs
      aren't covered (yt-dlp/ffmpeg resolve on their own).
- [x] Added: `stations_local.py` override (gitignored) so the server's custom station
      list survives pulls; radio stations yt-dlp can't resolve fall back to ffmpeg
      directly (stock default Jamendo Chillout was silent due to a cert mismatch).
- [x] Pushed. End-pass tests: radio, queue a YouTube link, skip, pause, station change,
      desktop pipe into Music and into another room all still work;
      `curl -s -X POST http://<server-ip>:3001/skip` → 403 `Forbidden`;
      `curl -s http://<server-ip>:3001/health` → ok; queueing `http://127.0.0.1:3000/`
      in the music panel → "url must point to a public host".

## Slice 3 — API/web hardening (`fix/03-web-hardening`) — server, nginx, packages/ui

- [x] **#4** Chat images: raster only (png/jpeg/webp/gif) — SVG rejected. Security
      headers moved into `security-headers{,-tls}.conf` snippets and included by every
      location, so `/api/` responses get nosniff/CSP/HSTS again (its CORS `add_header`s
      had silently dropped them).
- [x] **#5** Chat image limit 10 MB → 4 MB, 10 uploads/min per user, store capped at
      128 MB total (images live 60 s). The client never actually called `resizeImage()`
      (raw pastes >1 MB already died at nginx's default body limit); it now re-encodes to
      ≤4 MB at up to 3840 px, quality from 0.92 (strips EXIF/GPS too; GIFs under the cap
      pass through animated). nginx `/api/` gets `client_max_body_size 5m`.
- [x] Found while testing: repeat Enter during an upload sent the image again each time;
      bubbles downloaded the full image just to show a 128 px preview. Now: send guard +
      progress on the thumbnail (XHR upload progress), failed upload keeps image/text with
      an error; a ≤200 KB 480 px thumbnail is uploaded alongside and served from
      `/api/chat/image/:id/thumb` (falls back to full for old clients); bubble shows a
      placeholder until it loads. `resizeImage` stops retrying a format the browser
      can't encode (Safari + WebP re-encoded a full PNG at every quality step).
- [x] **#16 (part)** nginx access logs use `$uri` (no query string); `?token=` accepted
      only on the SSE route (pipe WS has its own check). Rest of #16 is in slice 4.
- [x] **#20 (part)** multer 1.4.5-lts → ^2.0.2 (DoS CVEs), @types/multer → ^2.0.0.
- [x] Pushed. End-pass tests:
  - `docker compose exec web nginx -t` → ok; app loads (CSP didn't break anything).
  - `curl -sI https://<domain>/api/health` shows `content-security-policy`,
    `x-content-type-options: nosniff`, `strict-transport-security`.
  - `docker compose logs --tail=20 web` → `/api/events` lines have no `?token=`.
  - Chat: paste a big screenshot → arrives (resized); paste a small GIF → animated.
  - Paste an image, press Enter 3× quickly → one message; thumbnail shows spinner then
    %; bubble preview appears quickly, click opens full size.
  - SVG upload refused: `curl -s -H "Authorization: Bearer <token>" -F "image=@x.svg;type=image/svg+xml" https://<domain>/api/chat/image`
    → "No image provided (PNG, JPEG, WebP or GIF)".
  - Soundboard upload + play still work (multer 2).

## Slice 4 — Client resilience (`fix/04-client-resilience`) — packages/ui

- [x] **#9** SSE reconnects itself on any error with exponential backoff + jitter (1 s →
      15 s) and a fresh ticket — EventSource's own retry gives up for good on non-200s
      like the 502 during an API restart. A 401 on the ticket request → login screen
      ("Your session expired"). After reconnecting, the room/user/member lists are
      refetched and a jail sentence that ended while disconnected is released.
- [x] **#10** Startup `getMe()` only clears the stored token on 401/404; on network
      errors/5xx it keeps the session and retries (loading screen says so).
- [x] **#13 (part)** `await room.setE2EEEnabled(true)` so the E2EE indicator is honest.
- [x] **#16 (rest)** SSE authenticates with a 30 s single-use ticket
      (`POST /api/events/ticket`) instead of the JWT in the URL. `?token=` still accepted
      for desktop builds that predate tickets (and the new client falls back to it if a
      server has no ticket endpoint) — remove once old builds are gone.
- [x] Also: `/api/server-info` was fetched with a relative URL, so the desktop app never
      showed the server city.
- [x] Pushed. End-pass tests:
  - While in a room: `docker compose restart api` → within ~15 s chat works again,
    user list/presence correct, no page reload.
  - `docker compose stop api`, reload the page → "Can't reach the server — retrying…";
    `docker compose start api` → logs straight back in.
  - DevTools → Network: the events request is `/api/events?ticket=…` (no JWT).
  - Session expiry: DevTools console `localStorage.setItem('distokoloshe_token', 'x')`,
    then `docker compose restart api` → login screen with "Your session expired".
  - E2EE lock still shows in Chrome/Safari.

## Slice 5 — Setup scripts & docs (`fix/05-docs`)

- [x] **#6** `init.sh` resolves the repo root correctly (wrote `infra/.env`) — verified
      by running it from a scratch copy.
- [x] **#19** README firewall table: add TCP 7882, drop public 7881 (nginx proxies it),
      warn that host-networked 7881/3001 aren't firewalled by Docker.
- [x] **#24** Backup uses SQLite's online backup (`better-sqlite3 .backup()` via
      `docker compose exec api`, no sqlite3 CLI in the image); restore deletes stale
      `-wal`/`-shm` files. Offline alternative documented.
- [x] **#27** Doc nits: README tree (`infra/music`, missing files), compose comments
      (music "headless browser", LiveKit ports, cert reload), init scripts'
      `./scripts/...` paths, TURN troubleshooting step that only curled `/server-info`,
      cert-renewal note (nginx reloads itself now; only LiveKit needs the cron), LiveKit
      Dockerfile `EXPOSE`, README security section updated for slices 2–4,
      `stations_local.py` documented. (Chat 413 message done in slice 3; Safari E2EE
      wording moved to slice 7, where it gets verified.)
- [x] Pushed. End-pass tests: in a scratch clone, `./infra/scripts/init.sh` writes `.env`
      at the repo root; backup command produces a tarball with `api/backup.db` + `certs`.

## Slice 6 — Jail enforcement via LiveKit webhooks (`fix/06-livekit-webhook`)

- [x] **#11** LiveKit sends webhooks to the API (`http://127.0.0.1:3000/api/livekit/webhook`,
      signature-verified with `WebhookReceiver`). On `participant_joined`, a user with an
      active punishment for that room is removed — a kept/replayed token no longer
      bypasses jail. LiveKit gets `LIVEKIT_API_KEY` in its env; entrypoint substitutes it
      into `webhook.api_key` (and refuses to start without it).
- [x] nginx returns 404 for the internal-only `/api/livekit/webhook` and
      `/api/music/notify` (both are called on 127.0.0.1:3000 directly).
- [x] `infra/scripts/check-jail-kick.py` — joins a room as a user via the music
      container's LiveKit SDK and reports whether they get kicked.
- [x] Pushed. End-pass tests:
  - After rebuilding, join any room → `docker compose logs api | grep livekit-webhook`
    shows `receiving events from LiveKit` (no `rejected:` lines).
  - `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<domain>/api/livekit/webhook` → 404.
  - Jail a user from room X (3 accounts), then:
    `docker compose exec -T music python - <jailed-username> "X" < infra/scripts/check-jail-kick.py`
    → `KICKED`, and the api log shows `removing jailed user`.
  - Normal joins, music bot and desktop pipe streams unaffected.

## Slice 7 — E2EE tightening (`fix/07-e2ee`) — depends on 2 and 6

Decided: option A now (tighten + honest docs). True E2EE (client-side key agreement, the
server can't decrypt) is its own project, scheduled after the UI redesign.

- [x] **#13** Random 256-bit per-room key in `rooms.e2ee_key` instead of
      `HMAC(secret, room name)`. New rooms (incl. jail rooms, seeded General) get a random
      key at creation; rooms that predate the column are seeded with the legacy derived
      key on first use, so calls in progress during the upgrade keep working.
- [x] Rotation on LiveKit `room_finished` (slice 6 webhook) — skipped if anyone is
      tracked in the room (just fetched the key via `/join`) or LiveKit already has a new
      instance with participants. Known edge: if a *whole* room drops for >30 s and some
      clients resume via the SDK while others rejoin fresh, they can end up on different
      keys until the resumed ones rejoin.
- [x] Music bot fetches its key from the API on every (re)connect via internal-only
      `GET /api/music/room-key` (nginx 404s it); no longer needs `E2EE_SECRET`. The Music
      room's key never rotates while the bot is in it.
- [x] Found while testing: a fresh install had no `Music` room in the DB (only `General`
      was seeded), so users couldn't join the bot's room and the bot found no key. The API
      now creates it at startup (`INSERT OR IGNORE`, no creator → undeletable).
- [x] Room rows sent to clients use explicit public columns — the room list,
      `room:created` and `room:deleted` used `SELECT *` and would have leaked every key.
- [x] Client E2EE detection uses LiveKit's `isE2EESupported()` (also covers Chromium
      Insertable Streams) instead of checking `RTCRtpSender.transform` only.
- [x] **#27 (part)** Mixed rooms documented from LiveKit's design, not tested here: a
      client without E2EE support joins unencrypted and can't decode encrypted
      participants. Safari *does* support E2EE (old "falls back on Safari" claim removed).
- [x] README: intro, features, env table and Security section describe the scheme
      accurately (not end-to-end against the server operator; chat is plain over TLS).
      `E2EE_SECRET` marked legacy; `init.sh` no longer generates it.
- [x] Pushed. End-pass tests:
  - Existing rooms: two people in a room during the upgrade still hear each other;
    newcomers joining afterwards can too (legacy key carried over).
  - Everyone leaves a room, wait ~40 s → `docker compose logs api | grep "rotated E2EE"`
    shows that room; rejoining with two people works (new key).
  - Music room: `docker compose logs music | grep E2EE` → `E2EE configured`; music audible.
  - Desktop pipe into a non-Music room is audible to others (ephemeral bot uses the key).
  - `curl -s -o /dev/null -w "%{http_code}\n" "https://<domain>/api/music/room-key?room=Music"` → 404.
  - DevTools → Network → `/api/rooms` response has no `e2ee_key`.

## Slice 8 — Soundboard (`fix/08-soundboard`)

- [x] **#26** Trimmer downmixes all channels to mono (it kept channel 0 only, dropping
      anything panned right). Server accepts only WAV (the trimmer's output), parses the
      header and requires consistent 16-bit PCM, 1–2 ch, 8–192 kHz, duration ≤ 10.5 s;
      cap 15 MB → 4 MB (nginx `/api/` allows 5 MB since slice 3, so 96 kHz devices fit).
      Parser checked via a Python port against `encodeWav`-style and `wave`-module files.
      Existing clips in other formats are untouched.
- [x] `/soundboard/:id/play` clamps the relayed `durationMs` to 0–15 s (was unvalidated).
- [x] Pushed. End-pass tests: upload a stereo clip with sound only in the right channel →
      audible; a clip trimmed to 10 s uploads; uploading a non-WAV via curl →
      "Clips must be WAV"; existing clips still play.

## Slice 9 — Updater & CI (`fix/09-updater-ci`) — desktop build via workflow_dispatch

- [ ] **#15** Re-sign `.app.tar.gz` (`tauri signer sign`) after codesign re-packages it;
      release assets get an arch in the macOS tarball name; server `detectPlatform` copes.
      Check whether the evermeet.cx ffmpeg is Intel-only (Rosetta dependency on arm64).
- [ ] **#17** Updater drops `Authorization` on cross-host redirects.
- [ ] **#23 (part)** Sidecar downloads verified (yt-dlp against its release
      `SHA2-256SUMS`; ffmpeg pinned + sha256).
- [ ] **#25** Release builds without the `devtools` feature.
- [ ] Push, STOP. Test: workflow_dispatch artifacts install on each OS; after merge + tag,
      macOS client auto-updates from the server.

## Slice 10 — yt-dlp freshness (`fix/10-ytdlp`)

- [ ] **#23 (part)** Music bot refreshes yt-dlp at container start (and daily).
- [ ] Desktop copies the bundled yt-dlp to the app data dir and self-updates it (`-U`)
      periodically, preferring the updated copy.
- [ ] Push, STOP. Test: YouTube queue on the bot and desktop pipe both work.

## Slice 11 — Runtime & reproducible builds (`fix/11-deps`)

- [ ] **#20** Node 20 (EOL) → 24 in Dockerfiles and CI; nginx 1.27 → 1.28; pin certbot;
      bump native deps (better-sqlite3, bcrypt) to versions with Node 24 musl builds.
- [ ] **#21** Commit lockfiles and switch Dockerfiles/CI to `npm ci`. Lockfile generation
      needs Node, which this machine lacks — decide then (generate on the dev server, or a
      one-off workflow).
- [ ] Push, STOP. Test: full `docker compose build` on the dev server; app smoke test.
