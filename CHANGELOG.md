# Changelog

## Unreleased

- Fixed: after reloading the page you could sometimes be missing from your own lists — not under "In this room" and not shown in your room on the rail — even though you were connected and everyone else saw you there. When your room join finished before the live-events connection opened (a coin toss on page load), the app never heard about its own join. It now shows you in the room as soon as the join succeeds, and refreshes rooms, people and who's where once the live-events connection opens

## 2.4.0 — Room Redesign

The room redesign is complete (2.3.1–2.3.11 shipped it step by step): a rooms rail with who's where, a People and Chat side panel, tiles that fit the call area, theater and multiview for shares and cameras, toasts instead of banners, votes to release from jail, a connection card with the server's location, and a settings window. This release adds:

- Fixed: after the server restarted you could stay connected (hearing and seeing everyone) but be missing from the room in everyone's lists until you switched rooms, or for a long time. When the live-events connection came back while LiveKit was still restoring its control link, the app didn't tell the server which room you were in; it now does, and also re-checks once LiveKit is fully back. And since Safari can keep a dead live-events connection "open" for a long while, the app's heartbeat now asks the server whether it still knows the connection and reopens it straight away when it doesn't (checking every 2 s while the server is unreachable) — so you're back in the list about as soon as the server is up
- While the connection is being restored the header says "Reconnecting…" (it showed "signalReconnecting"), and the "Reconnecting…" notice now appears in that case too

## 2.3.11 — Fullscreen in the Desktop App, Picture-in-Picture (room redesign R11a)

- Desktop app: fullscreen now uses the app window's own fullscreen, with the pinned share or camera filling it, instead of the webview's element fullscreen (which the macOS webview doesn't handle dependably). Escape or the window's green button leaves it; if the window was already fullscreen it stays that way
- In browsers that support it (Chrome, Edge, Safari), a pinned share or camera can pop out into a floating picture-in-picture window, so you can keep watching while you use other apps
- Quieter web logs: the container healthcheck uses a new `/healthz` endpoint over plain HTTP instead of following the HTTPS redirect (which logged a 301, a page load and two "unknown process exited" notices every 30 seconds), and the browser's `/favicon.ico` probe no longer logs an error

## 2.3.10 — Settings Window (room redesign R9)

- Settings is now a proper window with sections — Audio, Video & sharing, Hotkeys, Notifications, Privacy, Connection, App & updates — instead of one long scrolling popover. On phones it fills the screen. Open it from the gear in the control bar or the new gear next to your name
- Microphone, speaker and camera pickers now show the device you're actually using
- In browsers that can't choose a speaker (Safari), the settings say so instead of showing an empty list
- Fixed: pressing keys while setting a new hotkey could also set off your current hotkeys (e.g. toggle mute) in the app window. The desktop app's system-wide shortcuts can still fire while you rebind
- The light/dark switch is also under App & updates

## 2.3.9 — Connection Card (room redesign R8)

- Hovering (or tapping, or tabbing to) the signal bars now opens a proper connection card: quality, round-trip time, jitter, estimated distance, packet loss, connection type, send rate, codecs, transport and server — in light and dark mode
- The server's location is filled in automatically: without `SERVER_CITY` set, the server looks up the city of its own public IP once and shows it as "≈ City — estimated from the server's IP". Only the server's IP is sent (to ipinfo.io), the answer is remembered, and it's only looked up again if the IP changes. `SERVER_CITY` still wins, and `SERVER_GEO=off` turns the lookup off
- Self-hosters: the API container now receives `DOMAIN` from `.env` (used to notice IP changes) — no action needed if you use the bundled `compose.yml`

## 2.3.8 — Multiview (room redesign R7)

- Watch up to four shares or cameras at once: use a tile's pin button (or Ctrl/⌘-click it) to add it next to what's already on the stage — two sit side by side (or stacked in a tall window), three or four in a 2×2. Clicking a tile normally still shows just that one
- Each pane has its own buttons: unpin, "Show only this", fullscreen and stream sound
- The header's layout switch gains Multiview, which fills the stage with what's being shared and who's on camera
- If someone starts sharing while you're watching something else, a notice offers View or Add to split instead of taking over the stage
- Fullscreen takes the whole multiview along
- With "lock stream quality" on, videos that aren't on the stage are fetched at low quality while something is pinned, saving bandwidth for the ones you're watching

## 2.3.7 — Theater Mode (room redesign R6)

- Theater mode: pin a screen share or camera and it fills the call area, with everyone else in a strip down the side (or along the bottom in narrow windows). Pin by clicking a tile's video or its new pin button, or use the Grid / Theater switch in the room header; ✕ or Grid goes back. This replaces the old spotlight above the grid
- When someone starts sharing and nothing is pinned, their share is pinned for you automatically. Going back to the grid keeps it there; a new share will pin itself again
- The camera of whoever is pinned shows as a small picture in the corner — click it to swap between their screen and camera
- Fullscreen (header button, the button on the pinned video, or double-click): the controls and the mouse pointer fade after two seconds of no movement, and toasts and votes still show. Works in Safari too
- The "… is sharing their screen" bar above shares is gone — the name sits in the corner instead

## 2.3.6 — Toasts & Votes to Release (room redesign R5)

- Notices are now small toasts at the top of the call area instead of banners that pushed the video down: errors, someone joining, soundboard plays, vote results, jail news, "Reconnecting…" and "You're muted" (the last two stay until the situation clears)
- A running vote is a card just above the control bar with a countdown, a tally and what it needs to pass
- Anyone can now vote to release someone from jail: the people jailed from your room are listed in an orange pill in the room header, each with "Vote to release". It works like a jail vote — 30 seconds, more than half the people in the room must agree. The room creator's instant "Lift" is gone (it only ever worked for the creator anyway); the jailed person is told when a vote starts and how it went
- While you're in jail, the header shows how long is left and which room you'll go back to
- Browsers pick up a rebuilt web app on the next load — the page itself is no longer cached, so it can't keep pointing at the previous build
- Images in the Chat tab turn into an "Image expired" placeholder once the server has deleted them (about a minute after sending), instead of a thumbnail that opened a broken link
- Fixed: after opening the app you could be "not in a room" as far as the server was concerned — chat failed with "You must be in a room", others didn't see you in the member list, and votes/Whispers/soundboard notices were affected — until you rejoined. The live-events connection now picks up a room you joined just before it connected (regression from 2.3.0)

## 2.3.5 — Chat Tab (room redesign R4)

- New Chat tab in the side panel with every message since you joined the room — it clears when you switch rooms and is never stored on the server. Images stay viewable in the history (the full-size version is only kept for about a minute)
- The message box moved into the Chat tab, with an attach-image button as well as paste; the control bar is now a single row with a Chat button that shows how many messages you've missed
- Chat bubbles on tiles stay inside the tile: the latest two messages, each up to two lines, with "+N more · view messages" to open the Chat tab
- If a message can't be sent (for example "Slow down — too many messages"), you now see why instead of it silently disappearing

## 2.3.4 — Tiles That Fit (room redesign R3)

- Video tiles now grow and shrink to fill the call area — no more scrolling to find people; with a lot of people the grid scrolls once tiles would get too small
- Tiles are edge-to-edge video with the name and mic status in the corner; hover a tile (or tab to it, or just look on a touch screen) for its controls: volume, save soundbite, and "⋯" for mute for me and vote to jail
- Per-person volume moved from the control bar onto each tile and into the People panel (sliders button next to each person)
- The control bar always shows every button again — folding them into "⋯" made them jump back as the side panels collapsed

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
