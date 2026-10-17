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
- [x] Pushed. End-pass tests: radio, queue a YouTube link, skip, pause, station change,
      desktop pipe into Music and into another room all still work;
      `curl -s -X POST http://<server-ip>:3001/skip` → 403 `Forbidden`;
      `curl -s http://<server-ip>:3001/health` → ok; queueing `http://127.0.0.1:3000/`
      in the music panel → "url must point to a public host".

## Slice 3 — API/web hardening (`fix/03-web-hardening`)

- [ ] **#4** Chat images: reject SVG (allow png/jpeg/webp/gif only). nginx `/api/`
      blocks re-declare the security headers (nosniff, CSP, frame/referrer, HSTS in TLS).
- [ ] **#5** Chat image upload limit 10 MB → 600 KB (client already resizes to ≤500 KB),
      per-user upload rate limit, store cap by total bytes not count.
- [ ] **#16** nginx access logs strip query strings (custom `log_format` using `$uri`);
      `?token=` accepted only on the SSE route (pipe WS keeps its own check).
- [ ] **#20 (part)** multer 1.4.5-lts → 2.x (known DoS CVEs).
- [ ] Push, STOP. Test: chat text + image, soundboard upload/play, SSE presence;
      `docker compose logs web` shows `/api/events` without `?token=`; SVG upload refused.

## Slice 4 — Client resilience (`fix/04-client-resilience`) — packages/ui

- [ ] **#9** SSE: when EventSource closes for good (502 during API restart, 401, 429),
      reconnect with backoff; on 401 log out to the login screen.
- [ ] **#10** Startup `getMe()` only clears the stored token on 401, not on network/5xx.
- [ ] **#13 (part)** Await `room.setE2EEEnabled(true)` so the E2EE indicator is honest.
- [ ] Push, STOP. Test: `docker compose restart api` while connected → presence/chat
      recover without reload; stop the api container, reload page → still logged in once
      it's back.

## Slice 5 — Setup scripts & docs (`fix/05-docs`)

- [ ] **#6** `init.sh` resolves the repo root correctly (wrote `infra/.env`).
- [ ] **#19** README firewall table: add TCP 7882, drop public 7881 (nginx proxies it).
- [ ] **#24** Backup instructions use `sqlite3 .backup` / stop the api first.
- [ ] **#27** Doc nits: README tree (`infra/music`), compose "headless browser" comment,
      init scripts' `./scripts/...` paths, chat 413 message, Safari E2EE wording.
- [ ] Push, STOP. Test: fresh clone in a scratch dir → `./infra/scripts/init.sh` writes
      `.env` at the repo root.

## Slice 6 — Jail enforcement via LiveKit webhooks (`fix/06-livekit-webhook`)

- [ ] **#11** LiveKit sends webhooks to the API (`http://127.0.0.1:3000/api/livekit/webhook`,
      signature-verified with `WebhookReceiver`). On `participant_joined`, a user with an
      active punishment for that room is removed — a kept/replayed token no longer
      bypasses jail.
- [ ] Push, STOP. Test: normal joins unaffected; jailed user forcing a rejoin of the
      source room (e.g. replaying the old join token) gets kicked.

## Slice 7 — E2EE tightening (`fix/07-e2ee`) — depends on 2 and 6

Decision needed before starting: true E2EE (server cannot decrypt) needs client-side key
agreement — a larger redesign. This slice makes the current scheme tighter and the docs
honest.

- [ ] **#13** Random per-room key stored in the DB instead of `HMAC(secret, room name)`;
      rotated when LiveKit reports the room finished (webhook from slice 6), so former
      members/recreated rooms don't share keys. Music bot fetches its key from the API
      over the internal key (slice 2).
- [ ] **#27 (part)** Verify a mixed room (E2EE-capable + non-capable client) and document
      the result.
- [ ] README describes the scheme accurately.

## Slice 8 — Soundboard (`fix/08-soundboard`)

- [ ] **#26** Trimmer downmixes all channels (not just left). Server accepts only WAV
      from the trimmer, checks header duration ≤ 10.5 s, size cap ~4 MB; nginx
      `client_max_body_size` set explicitly for uploads so 88.2/96 kHz devices fit.
- [ ] Push, STOP. Test: upload stereo clip (both channels audible), long clip refused.

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
