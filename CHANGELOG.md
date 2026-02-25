# Changelog

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
