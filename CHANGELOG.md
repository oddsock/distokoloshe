# Changelog

## 2.3.3 — Control Bar That Fits (room redesign R2b)

- The control bar sits centred on the call area rather than the whole window, so it no longer drifts off-centre with the People panel open or covers the rooms list and side panel in narrow windows
- It stays a single row: when space runs out, soundboard, music, settings and volumes fold into a "⋯" menu, then deafen and screen share; on phones it's mic, camera and "⋯"
- Every popover — settings, soundboard, music, volumes, screen-share quality, the vote duration picker — stays fully on screen and opens next to its button (or the "⋯" menu when folded)

## 2.3.2 — New Rooms List & People Panel (room redesign R2a)

- The rooms list shows who's in each room as coloured avatars, with whoever's speaking highlighted; on medium-width windows it shrinks to room icons with member counts
- A new People panel (People button in the room header) lists who's in your room — with speaking, mic-off and "mute for me" — who's online elsewhere and in which room, and who's offline. On wide windows it opens beside the stage by default and remembers your choice; on narrow ones it slides over the stage
- Room options moved into a "⋯" menu in the room header: Whispers on/off, and **Delete room** for the room's creator
- You're always in a room: new accounts join General automatically, and if the room you're in is deleted you're moved to General
- Everyone gets their own avatar colour

## 2.3.1 — Tooltips That Stay On Screen (room redesign R1)

- Tooltips are no longer cut off at the edge of the window or hidden inside tiles and scrolling areas; long labels wrap instead of running off-screen
- Tooltips also appear when you move through the controls with the keyboard, and no longer get stuck open after a tap on touch screens
- Tooltips work over a fullscreen screen share
- The connection details card (hover the signal bars) always stays fully on screen, and opens with a tap on touch devices
- Banners fade in as intended (their animation was missing)

## 2.3.0 — Security & Reliability Fixes (project review)

- Known issue: YouTube links in the desktop audio pipe can fail with "Sign in to confirm you're not a bot" — yt-dlp now needs a JavaScript runtime for full YouTube support; bundling one is planned
- Jail credentials (the jailed user's LiveKit token and room key) are now sent only to the jailed user — previously every connected client received them
- Active jail sentences and votes survive an API restart (a timestamp comparison bug treated anything expiring later the same UTC day as already expired)
- Rooms that have ever had a vote can be deleted again (previously a 500); their jail room is removed with them. Deleting is refused while a vote or jail sentence is active
- Switching rooms (or being jailed) now removes you from the old room's Whispers chain
- Music bot control API (`:3001`) now rejects anything not from the API server — previously queue/skip/pause/station needed no auth and the bot listens on the host network
- The API↔music-bot shared key is now derived from `LIVEKIT_API_SECRET` instead of reusing `LIVEKIT_API_KEY`, which every client could read from its LiveKit token (and use to push fake now-playing updates to everyone)
- The music bot refuses to queue or stream URLs that point at private, loopback or link-local addresses
- Custom radio stations can live in `apps/music/stations_local.py` (gitignored) instead of editing `stations.py`, so updates never overwrite them
- A radio station that yt-dlp can't resolve (e.g. the default Jamendo stream, whose certificate currently doesn't match its hostname) is now handed straight to ffmpeg instead of leaving the radio silent
- Chat images up to 4MB / 4K: pasted images are re-encoded at high quality before upload (also strips photo metadata such as GPS location); anything over 1MB previously failed silently. GIFs stay animated
- Sending a chat image shows progress on the thumbnail (spinner while it's prepared, then upload %). Pressing Enter again meanwhile no longer sends duplicates, and a failed upload keeps the image and text with an error instead of silently sending text only
- Chat bubbles show a small preview uploaded alongside the image (with a placeholder while it loads) instead of downloading the full image; click it for full size
- Faster image preparation in Safari, which has no WebP encoder — it no longer re-encodes a full-size PNG at every quality step before falling back to JPEG
- Chat images are limited to PNG/JPEG/WebP/GIF — SVG is refused, since it can carry script — with a 4MB size cap, 10 uploads a minute per user and a 128MB cap on the in-memory store
- API responses carry the security headers again (nosniff, CSP, HSTS); the CORS headers on `/api/` had silently replaced them
- nginx access logs no longer record query strings, so login tokens on the live-events stream stay out of the logs; only that stream accepts a token in the URL now
- Upgraded multer to 2.x (fixes known denial-of-service vulnerabilities in 1.4.5-lts)
- Live updates (presence, chat, votes) recover by themselves after the server restarts — previously they stopped for good until you reloaded the page. Room, user and member lists are refreshed after reconnecting, and a jail sentence that ended while you were disconnected is released
- An expired login now returns you to the sign-in screen with "Your session expired", instead of the app silently going quiet
- Opening the app while the server is down or restarting no longer logs you out — it waits and retries until the server is back
- The live-events stream authenticates with a short-lived single-use ticket instead of your login token in the URL, so the token can't end up in server logs
- The E2EE indicator only shows once encryption has actually been enabled
- Desktop: the server location in the connection-quality tooltip now shows (it was fetched from the wrong address)
- `infra/scripts/init.sh` writes `.env` to the repo root again (it was writing `infra/.env`, so a fresh install's API exited on missing secrets)
- Jail can no longer be dodged by reconnecting with an earlier room token: LiveKit now notifies the API of every join (signed webhooks), and a jailed user who turns up in the room they were voted out of is removed straight away
- The internal-only endpoints (LiveKit webhooks, music-bot status notifications) are no longer reachable through the public site
- Each room now has its own random encryption key, stored on the server and replaced whenever the room empties — previously keys were derived from one server secret and the room name, so they never changed and a re-created room got the same key. Existing rooms keep their current key until they next empty, so calls survive the upgrade
- Server images run on Node 24 (Node 20 reached end of life) with nginx 1.30; certbot is pinned to v5.8.0 instead of `latest`; better-sqlite3 13 and bcrypt 6 (prebuilt for Alpine, no compiler needed)
- Removed nginx OCSP stapling, which Let's Encrypt certificates no longer support (it only produced a warning)
- macOS desktop: the bundled ffmpeg is now native Apple Silicon (the previous source was Intel-only, needing Rosetta, and has since disappeared, which would have broken the macOS build)
- Desktop builds pin ffmpeg 9.0.2 by checksum on every platform and verify yt-dlp against its release checksums
- macOS clients now receive auto-updates: the updater bundle is named with its architecture so the server's release sync recognises it, and it's re-signed after codesigning so the signature matches
- The server's update sync no longer sends `GITHUB_TOKEN` to GitHub's download CDN on redirects, and never serves a half-downloaded installer
- Tagged desktop releases no longer include the web inspector (manual test builds still do)
- Soundboard clips keep both stereo channels (mixed to mono) — the trimmer used only the left channel, so sound panned right was lost
- The server now enforces the soundboard's 10-second limit (checked from the WAV header) and accepts only the trimmer's WAV output, capped at 4MB (was 15MB of any audio)
- The `Music` room (or `MUSIC_ROOM_NAME`) is created automatically at startup — on a fresh install it didn't exist, so nobody could join the room DJ Tokoloshe plays in
- E2EE now also turns on in Chromium builds that only support Insertable Streams (LiveKit's own support check replaces a narrower hand-rolled one)
- README describes the encryption honestly: media is encrypted in the browser so the relay only sees ciphertext, but the server issues the keys, so this isn't end-to-end against whoever runs it; true end-to-end encryption is planned. `E2EE_SECRET` is now only needed on upgraded installs
- README: firewall table adds TCP 7882 and stops recommending opening 7881; backup instructions take a consistent SQLite snapshot instead of copying the live WAL database; cert-renewal, troubleshooting and project-structure sections brought up to date

## 2.2.4 — Screen-Share-First Tiles (UI redesign phase 3)

- Participant tiles now show the screen share in the main area at all times; a participant's camera (if also on) shrinks to a small picture-in-picture overlay in the corner instead of pushing a second thumbnail below the tile. Click the PIP to spotlight the camera, click the main area to spotlight the share.
- Tile height no longer changes when someone has both camera and screen share on — grid rows stay aligned.
- Your own camera can now be spotlighted the same way when you're sharing with your camera on (previously only your screen share was clickable).

## 2.2.3 — Screen Share: Adaptive Resolution (UI redesign phase 2)

- High and Ultra screen-share presets now publish 2 spatial layers (`L2T3_KEY`, up from `L1T3`) so viewers watching a small/non-spotlighted tile receive a lower **resolution** stream instead of just a lower framerate — meaningful bandwidth savings once multiple shares or a grid of small tiles are on screen. Low/Medium already published 3 spatial layers and are unchanged.
- Known limitation: Safari can only publish VP8 for screen share, which has no spatial-layer support — viewers of a Safari share still adapt by framerate only, not resolution.
- Known interaction: enabling "Lock stream quality" in settings disables adaptive streaming entirely, so a locked viewer pulls every tile at full resolution regardless of size.

## 2.2.2 — Internal Refactor (UI redesign phase 1)

- No intended behavior changes — groundwork for the upcoming theater-mode/multiview UI (see PLAN.md)
- Participant tiles, chat speech bubbles, and the stream-audio mute button extracted into shared components; the duplicated local/remote tile markup is now one `ParticipantTile`
- Control-bar popovers (settings, volumes, soundboard, music, pipe, share quality, stop-share confirm, vote duration picker) share one open/close state — only one can be open at a time
- Removed dead code in the screen-share hook and an unused icon import

## 2.2.1 — Bugfix Patch

- Muting a screen share's audio now sticks — it no longer silently unmutes when other track events fire (e.g. someone toggling their mic), and survives track re-subscribes
- Fullscreen screen-share now letterboxes within the viewport, keeping the overlay controls reachable when the shared resolution/aspect ratio differs from the viewer's screen
- Stopping a screen share no longer permanently breaks soundbite capture for that user
- Login/registration rate limits now apply per client IP instead of one shared bucket behind the nginx proxy
- Ultra screen-share preset bitrate raised from 8 to 20 Mbps

## 2.2.0 — Client-Piped URL Playback

- Desktop client can now decode any yt-dlp supported URL (YouTube, SoundCloud, Bandcamp, …) or local audio file and pipe the PCM to the music bot. Audio still appears to come from DJ Tokoloshe for everyone in the room.
- Bundled ffmpeg + yt-dlp sidecars per platform (staged by GitHub Actions on release).
- New `/api/music/pipe` JWT-authenticated WebSocket relay between the desktop client and the music bot.
- Single-streamer lock: radio auto-pauses when a pipe starts and auto-resumes on stop, disconnect, leave, or app close.
- Music bot gains an `external` mode with the same 2-second jitter pre-buffer as the radio path.

## 1.0.0 — Initial Public Release

### Voice & Video
- Voice and video rooms with auto-rejoin on login
- Screen sharing with quality presets (720p, 1080p, 1080p60, native)
- Browser-aware codec selection (AV1 on Firefox, VP9 on Chromium, VP8/H.264 fallback)
- Optional audio capture during screen share
- Per-user volume control (0–200%) with persistent settings

### Security
- End-to-end encryption (AES-GCM via LiveKit Encoded Transforms)
- Per-room key derivation using HMAC-SHA256 with dedicated E2EE secret
- Graceful fallback to transport encryption on unsupported browsers
- bcrypt password hashing (12 rounds), JWT auth with 7-day expiry
- Rate-limited login (20/15min) and registration (5/hour per IP)
- TLS 1.2/1.3 with HSTS, OCSP stapling, HTTP/3 (QUIC)
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy
- CORS disabled, 16KB body limit, parameterized SQL queries

### Moderation
- Democratic vote-to-jail system (30s window, quorum of 3, simple majority)
- Timed jail rooms with auto-kick from LiveKit
- Room creator can lift punishments early

### Social
- Whispers mode with Fisher-Yates random chain (live updates as users join/leave)
- Chat speech bubbles with image support
- Sound notifications — 4 synthesized packs (Mystical Chimes, Mischievous Pops, Retro Arcade, Digital Whispers) with 8 events each, all Web Audio API
- Soundboard with per-user clip upload/download

### Real-Time
- SSE-based presence (online/offline, room membership, 13 event types)
- Connection quality indicator with RTT, jitter, and server region
- Muted mic detection notification

### Desktop Client (Tauri v2)
- Windows/Linux/macOS support via shared `@distokoloshe/ui` package
- Configurable server URL — connects to any disTokoloshe instance
- Window state persistence
- Global shortcuts with modifier keys (OS-level mute/deafen, even when minimized)
- Self-hosted auto-updater with ed25519 signed binaries
- Immediate leave notification on window close (no SSE timeout delay)

### Infrastructure
- Docker Compose orchestration (web, api, livekit, certbot)
- `init.sh` — one-command secret generation
- `init-certs.sh` — automated Let's Encrypt certificate provisioning with dry-run
- LiveKit auto-detects TLS certs for dev/prod mode switching
- Certbot auto-renewal every 12 hours
- GitHub Actions CI for desktop builds with signing and GitHub Releases
- Server-side GitHub Release auto-sync for desktop updates (60-minute polling)

### Known Limitations
- Music bot archived due to LiveKit server SDK bug (FFI peer connection timeout)
- Desktop system tray menu not yet implemented
- No automated test suite (planned for future releases)
