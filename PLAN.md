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
- Jail ends early only by a **vote to release** (user, 2026-10-18): anyone in the room
  they were jailed from can start one; same rules as a jail vote (30 s, more than half of
  the people in the room, starter counts as yes, one vote per room at a time). No instant
  lift for anyone, the room creator included; the jailed person can't start one.

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
1. The control bar is docked to the **stage** and never hides buttons (user, 2026-10-18:
   folding made buttons snap back as the side panels collapsed and the stage widened). At
   every width the panels allow, the full row fits; it wraps only as a last resort.
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
      existed, the client never had a button); People toggle at every width. (Layout
      switcher + fullscreen added in R6.)
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
- [x] Folding reverted after testing (shipped with R3): buttons folded, then snapped back
      once the rail/panel collapsed and the stage widened. No "⋯"; the row always shows
      everything (wraps only as a fallback). `useElementWidth` removed.
- [x] Done in R4: `ControlBar` extracted once chat left the bar. (Stage extraction was
      done in R6 as `TheaterLayout` / `PinnedView` + tile builders.)
- [x] Released as 2.3.3. User tests: bar centred on the stage with the People panel open;
      narrow the window → buttons fold into "⋯" (two steps), the menu lists exactly what
      folded, each item opens its popover next to "⋯"; every popover stays on screen at the
      window edges; soundboard's clip trimmer opens above the soundboard; phone layout (one
      row: mic, camera, ⋯); vote-duration picker on tiles in the top row.

### R3 — Stage grid & tiles (2.3.4, together with the R2b no-fold fix)
- [x] Fit-to-stage grid: `layoutGrid()` picks the column count that makes 16:9 tiles
      largest in the measured grid region (`useElementSize`; region sized independently of
      its content, so no feedback loop); below 180 px per tile it scrolls instead.
- [x] New tile: full-bleed media, name tag with status icons bottom-left, `TileAction`s
      top-right (volume, soundbite, "⋯" → mute/unmute for me, vote to jail → duration),
      stream-audio mute among them; visible on hover/focus, always on touch, held while a
      tile popover is open. Camera PIP bottom-right, "Your source" top-left. Pin waits for
      theater mode (R6) — clicking the media still spotlights.
- [x] Per-person volume on the tile and in the People panel (sliders button per row);
      Volumes popover removed from the control bar.
- [x] Released as 2.3.4. User tests: 1, 2, 3, 5, 8+ people (tiles grow/shrink, no page
      scroll; many → scrolls), resize the window, spotlight above the grid, tile actions on
      hover / keyboard / touch, volume popover + People slider, ⋯ → mute for me, vote to
      jail picker, stream-audio mute on a share with audio.

### R4 — Chat (2.3.5)
User chose (2026-10-18): the message box moves into the Chat tab; the bar gets a Chat button.
- [x] Tile bubbles inside the tile: last 2 lines, each 2-line clamped, older faded,
      "+N more · view messages" opens the Chat tab; lines expire after 15 s (replaces the
      merged-bubble stacks that climbed out of the tile). "Your source" moved into the name tag.
- [x] Chat tab (`ChatPanel`): every message since joining, client-side only, cleared on
      room switch (any route — join, jail, deletion), grouped by sender, sticks to the
      newest; unread badge on the tab and the bar button. After testing (user): images
      swap to an "Image expired" placeholder 55 s after arrival instead of keeping a
      cached thumbnail that linked to a deleted full-size image (blob caching removed).
- [x] `ChatComposer` in the Chat tab: existing image flow + attach button; send errors
      (e.g. rate limit) now shown instead of swallowed; IME-Enter guard kept.
- [x] `ControlBar` extracted (buttons only; popovers stay in Room and anchor via
      `buttonRef`); one row with the Chat button (`accent` tone when open).

### R5 — Overlays, states & release votes (2.3.6)
- [x] Toast stack (`useToasts` + `Toasts`, top-centre of the stage) for errors, joins,
      soundboard plays, vote results, jail news, and state toasts while reconnecting / while
      the muted-mic warning holds — every inline banner is gone.
- [x] Vote card docked above the control bar in one bottom dock (countdown, tally bar,
      needs N of M, Jail / Keep or Release / Keep in jail).
- [x] Jail: header pill with countdown when you're jailed (+ toast); for the room, an
      orange pill listing who's jailed from it with **Vote to release**.
- [x] Release votes replace the creator-only Lift (user decision, product rules above):
      votes get `kind` ('jail' | 'lift') + `punishment_id`; `POST /api/votes {kind:'lift',
      punishmentId}`; a passed one ends the punishment (`punishment:lifted`); the jailed
      person is told when one starts and how it ended; a lift vote still open when the
      sentence runs out is voided. `POST /api/punishments/:id/lift` removed.
- [x] Countdowns parse server times as ISO (`sqliteUtcToMs`) and tick in small
      components (`useNow`) instead of re-rendering the room every second.
- [x] Released as 2.3.6. User tests (3 accounts for votes): error / join / soundboard
      toasts stack top-centre and fade; muted-mic and reconnecting toasts last as long as
      the state; vote card above the bar (narrow window too); jail someone → their header
      pill counts down, the room's orange pill lists them; Vote to release → card →
      passes → they're back; failed and time-ran-out-mid-vote cases; creator has no Lift.

### R6 — Theater mode (was phase 4) (2.3.7)
- [x] Pinned item fills the stage; the rest in a filmstrip (side on wide stages, bottom on
      narrow); filmstrip tiles = compact `ParticipantTile`, monitor badge on the pinned
      sharer's strip tile. Replaces the spotlight that sat above the grid.
- [x] Pin from a tile (click the media or the new Pin action) or the header's Grid /
      Theater switch; unpin with ✕ or Grid.
- [x] Fullscreen = the pinned view (header button, tile action, double-click). Controls
      and cursor fade after 2 s still (always on touch); no "X is sharing" bar at all now;
      Safari `webkit*` fallback (`lib/fullscreen.ts`); toasts + vote card shown inside it.
- [x] Auto-pin a remote share when nothing is pinned (sound untouched); going back to the
      grid keeps the shares showing then out of auto-pin, a new share can auto-pin.
- [x] Stage extraction, as far as it pays: `TheaterLayout` + `PinnedView` components;
      tiles built by `renderLocalTile` / `renderRemoteTile` in Room (grid and strip share
      them). `ScreenShareView` removed.
- [x] Released as 2.3.7. User tests: someone shares → it pins itself; strip at the side
      (wide window) and bottom (narrow); click a strip tile / its Pin → it takes the stage;
      PIP swaps share ↔ camera; ✕ / Grid → back to the grid and that share doesn't re-pin,
      a new share does; Theater button with only cameras; fullscreen via button, tile
      action and double-click — controls + cursor fade, a toast and a vote still show;
      Safari fullscreen; stream-audio mute on the pinned share.

### R7 — Multiview (was phase 5) (2.3.8)
- [x] `pins: Pin[]`, max 4 (`MAX_PINS`), deduped; 1 = full, 2 = side by side or stacked
      (whichever makes the panes bigger), 3–4 = 2×2 (third centred). `PinnedStage`
      replaces R6's `PinnedView`.
- [x] Click a tile = replace pins; Pin button / Ctrl-⌘-click = add a pane (toast when
      full); per-pane unpin / fullscreen / stream-audio mute / "Show only this"; ended
      tracks auto-removed; strip tiles hide each person's pinned sources.
- [x] Header switch gains Multiview (fills up to 4: shares, then speakers' cameras);
      Theater keeps the first pane.
- [x] New share while pinned: toast "Dave started sharing" with View / Add to split
      (shares already live in the first 3 s after connecting don't count).
- [x] Fullscreen the whole multiview container. Stretch done: with `lockStreamQuality`
      on (adaptive stream off), non-pinned videos get `setVideoQuality(LOW)` while
      something is pinned; everything goes back to HIGH in the grid.
- [x] Released as 2.3.8. User tests: Pin button / Ctrl-⌘-click on 2, 3, 4 tiles (layouts,
      stacked when the window is tall), fifth → toast; click a tile → it's solo again;
      pane ✕ / "Show only this"; header Multiview with cameras only; while one share is
      pinned someone else starts sharing → toast → View / Add to split; fullscreen with
      4 panes; a pinned share ending drops its pane.

### R8 — Connection card & server location (2.3.9)
- [x] Rich connection card on the signal bars (hover, keyboard focus, tap on touch)
      keeping everything the old tooltip showed, light and dark.
- [x] Server location "≈ City — estimated from the server's IP". User chose (2026-10-18)
      the **one-off lookup** over a local GeoIP database: `serverLocation.ts` resolves
      `DOMAIN` (now passed to the api container) for the public IP, asks ipinfo.io for that
      IP's city only when it differs from the cached one (`server_meta` table; without
      DOMAIN it asks for its own IP at most daily), re-checks every 6 h. Only the server's
      own IP is sent. `SERVER_CITY` still overrides (shown without "≈"); `SERVER_GEO=off`
      disables the lookup. `/api/server-info` → `{ city, estimated }`.
- [x] Released as 2.3.9. User tests: hover / tab to / tap the signal bars; with no
      SERVER_CITY the card shows "≈ <city> — estimated from the server's IP" (api log:
      "Server location: …"); restart the api → no new lookup (cached); with SERVER_CITY
      set it shows just that city; SERVER_GEO=off → no server row.

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
