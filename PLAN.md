# UI Redesign Plan — Theater Mode, Multiview & Cleanup

Goal: replace the inline spotlight with a proper theater layout, make screen-share-first
tiles with camera PIP, support multiple simultaneous shares (switch + multiview), and have
non-spotlighted/small panes drop **resolution** (spatial SVC layers) instead of framerate.
Includes code cleanup found during review.

Scope is frontend-only (`packages/ui`) — no server or protocol changes
(except the possible popout presence flag in Phase 6).

**Workflow**: one phase at a time. Each phase ends with commit + push, then **STOP** —
the user pulls onto their dev server and tests there. Do **not** build locally
(no `docker compose build`, no `npm run build`); desktop releases go through the
GitHub Actions tag+release flow. Next phase starts only after the user confirms.

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

- [ ] In `useScreenShare.ts` `QUALITY_PRESETS`, change `scalabilityMode` for
      **high** and **ultra** from `'L1T3'` → `'L2T3_KEY'`. Low/medium already use
      `L3T3_KEY`. This gives every preset ≥2 spatial layers so `adaptiveStream`
      can serve small panes a lower resolution instead of only dropping fps.
- [ ] Sanity-check encoder cost on the sharing machine at ultra (4K120 + one extra
      spatial layer). If CPU is a problem on real hardware, fall back to `L2T2_KEY`
      for ultra only.
- [ ] Known limitation (document in CHANGELOG, no code): Safari publishes VP8
      (no spatial SVC) — viewers of a Safari share still adapt by framerate only.
- [ ] Known interaction: the `lockStreamQuality` setting disables `adaptiveStream`
      entirely (useLiveKitRoom.ts ~90), so locked viewers pull every pane at full
      res. Leave behavior as-is for now; stretch goal below.
- [ ] Commit + push, STOP. User verifies on dev server: share at High from Chrome,
      view in a second Chrome profile with the tile small vs spotlighted —
      `chrome://webrtc-internals` should show the received resolution
      (not just framerate) drop when small.

## Phase 3 — Participant tile: share-first with camera PIP

Current problem: camera wins the tile's main area and the share drops to a stacked
thumbnail below it (Room.tsx 1588–1670), making the share tiny and tile heights ragged.

- [ ] In `ParticipantTile`: **screen share always takes the main area**; camera
      renders as a small PIP overlay (e.g. bottom-right, ~1/4 width) inside the same
      aspect-video box. No more stacked thumbnail → constant tile height.
- [ ] Click main area → spotlight the share. Click camera PIP → spotlight the camera.
- [ ] Single `StreamAudioMuteButton` placement (main area corner) — the two
      conditional variants go away.
- [ ] Apply the same logic to the local tile (self-preview).
- [ ] Commit + push, STOP. User verifies on dev server: one user with camera+share
      on — grid rows stay aligned, PIP swap works, stream-audio mute reachable.

## Phase 4 — Theater mode (single spotlight, done right)

Current problem: spotlight renders inline above the full-size grid capped at 70vh
(Room.tsx 1377–1465); native fullscreen is the only real viewing mode and its controls
are hover-only (ScreenShareView.tsx 91).

- [ ] **Layout**: when something is pinned, the main content area becomes the video
      filling all available height; the participant grid collapses to a horizontal
      **filmstrip** (small fixed-height tiles, `overflow-x: auto`) along the bottom,
      above the control bar. Banners (vote/punishment/errors) overlay or sit above.
- [ ] **Filmstrip tiles**: reuse `ParticipantTile` in a `compact` variant; tiles with
      an active share get a monitor badge.
- [ ] **Controls in fullscreen**: show on `mousemove` and fade after ~2s idle
      (not hover-only); always visible on touch devices; auto-hide cursor with the
      controls in fullscreen.
- [ ] **Double-click video** toggles fullscreen.
- [ ] **Hide the "X is sharing their screen" header bar in fullscreen**
      (ScreenShareView.tsx 64–71).
- [ ] **Safari fullscreen fallback**: use `webkitRequestFullscreen` /
      `webkitfullscreenchange` / `document.webkitFullscreenElement` when the
      unprefixed API is missing.
- [ ] **Auto-spotlight**: when a remote share starts and nothing is pinned, pin it
      (replaces the sound-only reaction at Room.tsx 775–777 — keep the sound).
- [ ] Commit + push, STOP. User verifies on dev server: pin/dismiss, filmstrip scroll
      with 6+ participants, fullscreen controls on mouse + touch, Escape exits,
      camera spotlight PIP-swap still works.

## Phase 5 — Multiview (multiple simultaneous shares)

- [ ] **State**: `spotlight: {identity, source} | null` →
      `pinned: Array<{identity, source}>`, capped at **4**, deduped by identity+source.
- [ ] **Layouts** in the theater area: 1 pin = full; 2 pins = side-by-side (stack
      vertically if the container is portrait); 3–4 pins = 2×2 grid.
- [ ] **Switch vs add**: clicking a share (tile or filmstrip) **replaces** the pins
      with just that one (the common "look at yours now" case). A small pin/+ button
      on hover — and ctrl/cmd-click — **adds** it as a pane.
- [ ] **Per-pane controls**: each pane keeps its own dismiss / stream-audio mute /
      fullscreen via `ScreenShareView`; add a "make solo" button (collapse to 1 pin).
- [ ] **Auto-dismiss**: generalize the existing effect (Room.tsx 980–997) to filter
      ended tracks out of the array; exiting theater = clear array.
- [ ] **New-share toast**: when a share starts while ≥1 pin is active, do NOT steal
      focus — show a dismissible toast "Dave started sharing" with **View** (replace)
      and **Add to split** actions.
- [ ] **Fullscreen the whole multiview container**, not individual panes.
- [ ] Commit + push, STOP. User verifies on dev server with 3 sharing participants:
      switch, add, 2×2, one sharer stops (pane auto-removed, layout reflows),
      fullscreen split view, per-pane audio mute.

Stretch:
- [ ] When `lockStreamQuality` is on, manually call `setVideoDimensions()` on
      non-pinned publications so filmstrip tiles don't pull full-res streams.

## Phase 6 — Desktop app (Tauri): fullscreen + pop-out

The web Fullscreen API behaves differently per webview engine — WKWebView (macOS),
WebView2 (Windows), webkit2gtk (Linux) — and a pop-out is a separate webview window
with its own JS context (it cannot share the main window's MediaStream objects).

- [ ] **Fullscreen fallback in Tauri**: feature-detect `document.fullscreenEnabled`;
      where the element-fullscreen API is missing/broken (notably WKWebView), fall
      back to `getCurrentWindow().setFullscreen(true)` + a CSS fixed-inset overlay
      that makes the theater container fill the window. Wire Escape to exit both.
      Test on all three OSes via the CI build.
- [ ] **Pop-out window (desktop only)**: "Pop out" button on each pane/share opens a
      new `WebviewWindow` with a minimal route (e.g. `#/popout?roomId=…&identity=…&source=…`).
      The popout is its own LiveKit client: it calls `api.joinRoom(roomId)` for a
      fresh token + e2eeKey and subscribes **video-only** (no mic publish, no audio
      playback — main window keeps audio, avoids double playback and echo).
- [ ] Server check (likely none needed): confirm a second join by the same user
      doesn't kick the first session's presence — if it does, add a
      `viewer`/`popout` flag to the join endpoint that skips presence/membership.
- [ ] Popout window chrome: always-on-top toggle, resizable, remembers size/position;
      closes automatically when the underlying share ends; main window "pop back in".
- [ ] Web browsers get a cheap variant for free where supported: Document
      Picture-in-Picture (Chromium) or `video.requestPictureInPicture()` for
      single-share panes. Optional, behind feature detection.
- [ ] Commit + push, STOP. User verifies desktop builds (via GitHub Actions artifacts)
      on mac + windows/linux: fullscreen enter/exit (button, double-click, Escape),
      pop-out opens and plays, no double audio, close/reopen, share ends while
      popped out.

## Phase 7 — Verification & release

- [ ] Typecheck only locally (`tsc --noEmit`) — all builds happen on the user's dev
      server / GitHub Actions.
- [ ] Manual matrix on dev server: Chrome↔Chrome, Chrome↔Firefox, Safari viewer, mobile layout
      (share button hidden — filmstrip/theater must still work as viewer), E2EE room,
      each quality preset, `lockStreamQuality` on/off.
- [ ] Update CHANGELOG.md; bump version.
- [ ] Desktop release via GitHub Actions tag+release flow (not local builds).
