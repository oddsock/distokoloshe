# UI Redesign Plan

Phases 1–3 (done, shipped in 2.2.2–2.2.4): code cleanup, spatial-layer screen share,
share-first tiles with camera PIP. The original phases 4–7 (theater, multiview, desktop
fullscreen/pop-out, release) are **superseded by the Room Redesign below**, which folds
them in.

**Mockup:** `design/mockups/room-redesign.html` (self-contained; open locally). Its
dashed top bar flips stage layout, side panel, device, theme and overlay states.

**Product rules (decided with the user, 2026-10-18):**
- No "leave room" option, ever, and no not-in-a-room state — you can switch rooms but are
  always in one; nobody can watch or listen to a room without being in it.
- Side panel opens on **People** by default (where it fits beside the stage).
- Grid tiles **shrink to fit** — the stage never scrolls.
- Chat keeps tile bubbles (fixed so they stay inside the tile) **and** a Chat tab showing
  every message since you joined; cleared when you switch rooms; never stored on the server.
- Keep all of today's connection details (RTT, jitter, distance, loss, ICE, bitrate,
  codecs, transport, server) in a hover card.
- Server location shown as "≈ City — estimated from the server's IP" (no triangulation).

**Workflow** (agreed 2026-10-18): one phase at a time on `main`. Each phase ends with a
version bump (apps/desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock) + a
CHANGELOG entry, a pushed commit and a pushed `v*` tag (GitHub Actions builds and releases
the desktop client) — then **STOP** while the user tests on the dev server and the client
build. No local builds (no Node on this machine; the dev-server build is the first compile).

---

## Phase 1 — Code cleanup (land first, keeps the redesign diff reviewable)

- [x] **Extract `parseParticipantMetadata()`** helper in `packages/ui/src/lib/utils.ts`
      (or next to `getPipeTitle` in Room.tsx). Replaces the three duplicated
      `JSON.parse(p.metadata || '{}')` try/catch blocks
      (Room.tsx ~768, ~810, ~1550).
- [x] **Collapse the 8 copy-pasted "close popover on outside click" effects**
      (Room.tsx 655–755) into a single popover state:
      `openPopover: 'quality' | 'stopShare' | 'settings' | 'volumes' | 'soundboard' | 'music' | 'pipe' | 'durationPicker' | null`
      plus one `useEffect` that closes on outside click. Bonus: enforces only one
      popover open at a time.
- [x] **Deduplicate the mic toggle** — the control bar button (Room.tsx ~1797)
      re-inlines what `handleToggleMute` (Room.tsx 152–157) already does. Use the callback.
- [x] **Remove dead `tracksRef` in `useScreenShare.ts`** — written/cleared in three
      places, never read.
- [x] **`ScreenShareView` composes `VideoTrackView`** instead of re-implementing the
      attach/detach/Safari-play logic (ScreenShareView.tsx 21–35).
- [x] **Extract `ChatBubbles` component** — the speech-bubble stack is duplicated
      verbatim for local (Room.tsx 1479–1494) and remote (1566–1581) tiles.
      Only the bubble color differs (blue vs green) — make it a prop.
- [x] **Extract `StreamAudioMuteButton` component** — duplicated twice with identical
      classes (Room.tsx 1630–1642 and 1656–1668).
- [x] **Extract `ParticipantTile` component** unifying the local + remote tile JSX
      (~80 lines near-duplicated). Local differences (mirror, "(You)" label, deafened
      icon, no vote/mute buttons) become props. **Prerequisite for Phase 3** — the
      share-first redesign happens inside this component.
- [ ] Commit + push, STOP. User verifies on dev server: join a room in two browsers,
      camera + share + chat bubbles + soundboard + volume popovers all behave as before.

Optional (nice-to-have, not blocking):
- [ ] Extract `ControlBar`, `VoteBanner`, `RoomsSidebar` from Room.tsx (2,036 lines).
- [ ] Derive `isSharing` from `localParticipant.isScreenShareEnabled` instead of
      hand-synced state in `useScreenShare` (stateVersion already bumps on
      LocalTrackPublished/Unpublished, so it stays fresh).

## Phase 2 — Encoding: drop resolution, not frames (tiny, independent)

- [x] In `useScreenShare.ts` `QUALITY_PRESETS`, change `scalabilityMode` for
      **high** and **ultra** from `'L1T3'` → `'L2T3_KEY'`. Low/medium already use
      `L3T3_KEY`. This gives every preset ≥2 spatial layers so `adaptiveStream`
      can serve small panes a lower resolution instead of only dropping fps.
- [x] Sanity-check encoder cost on the sharing machine at ultra (4K120 + one extra
      spatial layer). **Confirmed fine on user's hardware 2026-07-25.**
- [x] Known limitation (document in CHANGELOG, no code): Safari publishes VP8
      (no spatial SVC) — viewers of a Safari share still adapt by framerate only.
- [x] Known interaction: the `lockStreamQuality` setting disables `adaptiveStream`
      entirely (useLiveKitRoom.ts ~90), so locked viewers pull every pane at full
      res. Leave behavior as-is for now; stretch goal below.
- [x] Commit + push, STOP. User verifies on dev server: share at High from Chrome,
      view in a second Chrome profile with the tile small vs spotlighted —
      `chrome://webrtc-internals` should show the received resolution
      (not just framerate) drop when small. **Confirmed 2026-07-25.**

## Phase 3 — Participant tile: share-first with camera PIP

Current problem: camera wins the tile's main area and the share drops to a stacked
thumbnail below it (Room.tsx 1588–1670), making the share tiny and tile heights ragged.

- [x] In `ParticipantTile`: **screen share always takes the main area**; camera
      renders as a small PIP overlay (bottom-left, ~1/4 width) inside the same
      aspect-video box. No more stacked thumbnail → constant tile height.
- [x] Click main area → spotlight the share. Click camera PIP → spotlight the camera.
- [x] Single `StreamAudioMuteButton` placement (main area corner) — the two
      conditional variants go away.
- [x] Apply the same logic to the local tile (self-preview) — also wired up
      `onSpotlightCamera` for the local tile, which previously had no camera
      spotlight click target at all (camera always filled the main area).
- [x] Commit + push, STOP. User verifies on dev server: one user with camera+share
      on — grid rows stay aligned, PIP swap works, stream-audio mute reachable.
      (Shipped in 2.2.4.)

## Room Redesign (supersedes old phases 4–7)

Review findings this addresses: CSS tooltips clip and run off-screen; tile chat bubbles
stack out of the scroll area and vanish after 15 s with no history; the control bar is
centred on the window (not the stage), covers the bottom tile row and, in narrow windows,
spills over the rail (connection bars, logout) and the side panel (chat box); spotlight
sits above the grid in one scrolling area; banners stack inline and shift the layout
("Reconnecting" renders below the grid); tile actions are hover-only; settings is 8
sections in a 340 px scrolling popover; "Lift" shows for every member though only the
room creator may lift; mobile control bar wraps over content.

Responsive rules (apply in every phase):
1. The control bar sizes to the **stage** (container query, not the window) and folds by
   priority into "⋯": soundboard, music, settings first; then deafen and share. It never
   grows wider than the stage.
2. Below ~1080 px window width the side panel is an overlay drawer (starts closed there).
3. Below ~860 px the room rail collapses to icons (connection bars + lock stay visible).
4. Below 640 px: mobile layout (R10).

### R1 — Foundations
- [x] `TooltipLayer`: one app-wide tooltip for every `data-tooltip` (existing call sites
      unchanged), portal + clamp + flip, mouse and keyboard focus only (not touch), live
      label updates, hides on click/scroll/Escape/unmount; renders inside the fullscreen
      element when needed. SignalStrength's card moved onto `<Floating>` (tap on touch).
- [x] Shared positioning primitive (`placeFloating` + `<Floating>`: portal, flip, clamp to
      viewport) — used by tooltips and the connection card now; the control-bar popovers
      move onto it in R2 (rebuilding them here would be redone there).
- [x] Shared CSS moved from the duplicated `apps/web` + `apps/desktop` `globals.css` into
      `packages/ui/src/styles/base.css` (CSS `::after` tooltips removed; missing `fadeIn`
      keyframes added — banner fade-ins never played).
- [x] `STYLE_GUIDE.md`: tooltips & floating boxes section, z-index layer.
- [x] Released as 2.3.1. User tests: hover controls at the window edges and inside tiles
      (no clipping), tab through the control bar (tooltips on focus), touch device (no
      stuck tooltips; tap the signal bars for the card), fullscreen screen share
      (tooltips visible), banners fade in.

### R2a — Room shell: rail, header, side panel (2.3.2)
- [x] `RoomRail`: rooms with member avatar stacks (max 5 + "+N") and speaking ring
      (replaces the nested member lists); icon rail at md–lg with counts + tooltips;
      drawer on phones; user card (avatar, name, signal bars, E2EE lock, log out).
      Settings gear waits for the settings dialog (R9).
- [x] `StageHeader`: room badge, count, Whispers pill, room "⋯" menu (on `<Floating>`)
      with Whispers on/off and **Delete room…** for its creator (new — the server endpoint
      existed, the client never had a button); People toggle at every width. Layout
      switcher + fullscreen arrive with R6.
- [x] `SidePanel` + `PeopleList` (replaces `UserList`): In this room (speaking / mic off /
      mute-for-me toggle, moved from the rail) · Elsewhere (with room name) · Offline.
      Column from 1080 px, open by default, remembered; overlay drawer below, starts closed.
- [x] Always in a room: with no usable last room (new user, room deleted, last room was a
      jail whose sentence ended) you join the default room; if your room is deleted you're
      moved there with a notice.
- [x] Per-user avatar colours (`avatarColor`).
- [x] Released as 2.3.2. User tests: rail at ≥1024 / 768–1023 / phone widths; avatars +
      speaking ring; People panel sections + mute-for-me; panel open/close remembered,
      overlay below 1080 px; room "⋯" menu (Whispers, delete as creator → everyone moved
      to General); a brand-new account lands in General.

### R2b — Room shell: control bar (2.3.3)
- [x] Control bar docked to the stage (`absolute` in `<main class="relative">`, centred on
      it), one row, no wrapping. Folds by **stage width measured in JS**
      (`useElementWidth`) rather than a CSS container query — the "⋯" menu renders in a
      portal outside the stage, where container queries can't reach: <640 px volumes,
      music/pipe, soundboard, settings → "⋯"; <420 px deafen + share too. **No leave button.**
- [x] All control-bar popovers (stop share, share quality, volumes, music, pipe,
      soundboard, settings) and the tile vote-duration picker on `<Floating zClass="z-50">`;
      a folded button's popover anchors to "⋯". MusicControls / DeviceSettings / Soundboard
      no longer position themselves (their `isMobile` positioning variants are gone).
- [x] `ControlButton` (tones neutral/danger/success, forwards refs) replaces nine
      hand-styled buttons.
- [x] Chat input stays in the bar until R4.
- [ ] Moved to R4: extracting the whole `ControlBar` (and `Stage`) out of Room.tsx — with
      the chat input still inside it the component needs ~40 props; it gets far smaller
      once chat moves to the side panel.
- [x] Released as 2.3.3. User tests: bar centred on the stage with the People panel open;
      narrow the window → buttons fold into "⋯" (two steps), the menu lists exactly what
      folded, each item opens its popover next to "⋯"; every popover stays on screen at the
      window edges; soundboard's clip trimmer opens above the soundboard; phone layout (one
      row: mic, camera, ⋯); vote-duration picker on tiles in the top row.

### R3 — Stage grid & tiles
- [ ] Fit-to-stage grid (ResizeObserver): columns/rows from participant count and stage
      size so tiles shrink; below a minimum tile width, fall back to scrolling.
- [ ] New tile: full-bleed media, name tag with mic state bottom-left, actions top-right
      (pin, volume, soundbite, "⋯" → mute for me, vote to jail); always visible on touch.
- [ ] Per-person volume moves to the tile action + People panel slider (Volumes popover
      removed from the control bar).

### R4 — Chat
- [ ] Tile bubbles: max 2, each clamped to 2 lines, older one faded, "+N more · view
      messages" opens the Chat tab; bubbles can't leave the tile.
- [ ] Chat tab: every message since joining (client-side only, cleared on room switch),
      grouped by sender, image thumbnails → full size, unread badge on the tab and the
      control-bar button.
- [ ] Composer in the Chat tab with the existing image flow (resize, thumbnail, progress,
      retry, paste).

### R5 — Overlays & states
- [ ] Toast stack (top-centre of the stage) for errors, joins, soundboard plays,
      reconnecting, muted-mic warning — replaces all inline banners.
- [ ] Vote card docked above the control bar (countdown, tally bar, Jail / Keep).
- [ ] Jail: header pill with countdown + toast; "Lift" only for the room creator (bug fix).

### R6 — Theater mode (was phase 4)
- [ ] Pinned item fills the stage; the rest in a filmstrip (side on wide stages, bottom on
      narrow); filmstrip tiles = compact `ParticipantTile`, monitor badge on sharers.
- [ ] Fullscreen controls show on mouse move and fade after ~2 s (always on touch), cursor
      hides with them; double-click toggles fullscreen; hide the "X is sharing" bar in
      fullscreen; Safari `webkit*` fullscreen fallback.
- [ ] Auto-pin a remote share when nothing is pinned (keep the sound).

### R7 — Multiview (was phase 5)
- [ ] `pinned: Array<{identity, source}>`, max 4, deduped; 1 = full, 2 = side by side
      (stacked if portrait), 3–4 = 2×2.
- [ ] Click a share = replace pins; pin button / ctrl-cmd-click = add a pane; per-pane
      unpin / fullscreen / stream-audio mute / "make solo"; ended tracks auto-removed.
- [ ] New share while pinned: toast "Dave started sharing" with View / Add to split.
- [ ] Fullscreen the whole multiview container. Stretch: with `lockStreamQuality` on,
      `setVideoDimensions()` for non-pinned publications.

### R8 — Connection card & server location
- [ ] Rich connection card on the signal bars (hover; tap on touch) keeping everything
      today's tooltip shows.
- [ ] Server location "≈ City — estimated from the server's IP": the API finds its public
      IP (resolve `DOMAIN`, or LiveKit's STUN result), geolocates it once and caches it,
      re-checking when the IP changes; `SERVER_CITY` still overrides. Decide at this
      phase: local GeoIP database (no third-party call) vs a one-off lookup service.

### R9 — Settings dialog
- [ ] Modal with tabs: Audio, Video & sharing, Hotkeys, Notifications, Privacy,
      Connection, App & updates — moves `DeviceSettings` sections; full-screen sheet on mobile.

### R10 — Mobile
- [ ] One-row bar: mic, camera, deafen, chat, "⋯" (share, soundboard, music, settings).
- [ ] Chat / People as a bottom sheet; rooms as a full-height drawer from ☰; stacked
      tiles fill the screen.

### R11 — Desktop: fullscreen + pop-out (was phase 6)
- [ ] Tauri fullscreen fallback where element fullscreen is missing/broken (WKWebView):
      `getCurrentWindow().setFullscreen(true)` + fixed-inset overlay; Escape exits both.
- [ ] Pop-out `WebviewWindow` per pane: its own LiveKit client, video-only (no mic, no
      audio playback). Needs its **own LiveKit identity** (same identity would kick the
      main window) — and the slice-6 jail webhook must map that identity back to the user
      so a jailed user can't watch their source room through a pop-out. Join endpoint
      gets a viewer/pop-out flag that skips presence and applies the punishment check.
- [ ] Always-on-top toggle, remembers size/position, closes when the share ends, "pop back in".
- [ ] Web: Document Picture-in-Picture (Chromium) / `requestPictureInPicture()` where available.

### R12 — Verification & release (was phase 7)
- [ ] Manual matrix: Chrome↔Chrome, Chrome↔Firefox, Safari viewer, mobile, E2EE room,
      each quality preset, `lockStreamQuality` on/off, narrow windows (responsive rules).
- [ ] CHANGELOG + version bump; desktop release via the tag flow.
