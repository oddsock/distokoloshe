# disTokoloshe Web — UI Style Guide

Reference for maintaining consistent styling across all components. When adding new buttons, menus, or features, follow the patterns documented here.

**Source of truth:** `DeviceSettings.tsx` — when in doubt, match its conventions.

---

## Color Palette

### Backgrounds

| Purpose | Light | Dark |
|---------|-------|------|
| Page/container | `bg-white` | `dark:bg-zinc-900` |
| Card/sidebar/popover | `bg-white` | `dark:bg-zinc-800` |
| Input/select/tertiary | `bg-zinc-100` | `dark:bg-zinc-700` |
| Frosted (control bar) | `bg-white/80 backdrop-blur-xl` | `dark:bg-zinc-800/80` |

### Text

| Purpose | Light | Dark |
|---------|-------|------|
| Primary | `text-zinc-900` | `dark:text-white` |
| Secondary | `text-zinc-700` | `dark:text-zinc-300` |
| Tertiary/muted | `text-zinc-500` | `dark:text-zinc-400` |
| Placeholder | `text-zinc-400` | `dark:text-zinc-500` |

### Borders

| Purpose | Light | Dark |
|---------|-------|------|
| Primary | `border-zinc-200` | `dark:border-zinc-700` |
| Input/popover | `border-zinc-300` | `dark:border-zinc-600` |
| Frosted | `border-zinc-200/50` | `dark:border-zinc-700/50` |

### Accent Colors

| Color | Use case | Typical classes |
|-------|----------|----------------|
| **Indigo** | Primary actions, focus rings, active states | `bg-indigo-600`, `text-indigo-500` / `dark:text-indigo-400` |
| **Red** | Danger, muted state, destructive actions | `bg-red-500/20 text-red-400` |
| **Green** | Success, camera-on, online, confirm | `bg-green-500/20 text-green-400` |
| **Amber** | Warnings, votes | `border-amber-500/40 text-amber-600 dark:text-amber-400` |
| **Orange** | Jail/punishment indicators | `bg-orange-500/10 text-orange-400` |
| **Purple** | Whisper mode indicators | `bg-purple-500/20 text-purple-400` |
| **Blue** | Active speaker glow | `bg-blue-400` |

### Semantic Transparency Scale

For toggle/status backgrounds, use `/10`, `/20`, `/30` opacity steps:
- Normal: `bg-{color}-500/10`
- Hover: `hover:bg-{color}-500/20` or `hover:bg-{color}-500/30`
- Active: `bg-{color}-500/20`

---

## Buttons

### Primary (Indigo)

```
bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors
```

Sizes: `px-3 py-2 text-sm` (standard) | `py-2 px-4 text-base` (form submit) | `px-2.5 py-1 text-xs` (compact/popover)

### Secondary (Neutral)

```
bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600
text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors
```

### Danger

```
bg-red-500 text-white hover:bg-red-600 rounded-lg transition-colors
```

### Toggle States (Control Bar)

**Off/inactive:**
```
bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600
```

**On states by action type:**

| State | Classes |
|-------|---------|
| Muted | `bg-red-500/20 text-red-400 hover:bg-red-500/30` |
| Deafened | `bg-red-500/20 text-red-400 hover:bg-red-500/30` |
| Camera on | `bg-green-500/20 text-green-400 hover:bg-green-500/30` |
| Screen share on | `bg-green-500/20 text-green-400 hover:bg-green-500/30` |

### Icon Button (Sidebar)

```
text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors
```

### Small/Compact Button

```
px-2 py-0.5 rounded text-[10px] font-medium
bg-zinc-100 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300
border border-zinc-300 dark:border-zinc-500 hover:border-indigo-500 transition-colors
```

### Disabled State

```
disabled:opacity-50 cursor-not-allowed
```

### Button Sizes

| Context | Padding | Text |
|---------|---------|------|
| Control bar | `px-3 md:px-4 py-2` | `text-sm` |
| Menu item | `px-3 py-1.5` | `text-xs` |
| Compact/tag | `px-2 py-0.5` | `text-[10px]` |
| Form submit | `py-2 px-4` | `text-base` |

---

## Tooltips & Floating Boxes

**Tooltips:** put `data-tooltip="Label"` on any element. `<TooltipLayer>` (mounted once
in `RoomPage`) shows it on mouse hover and keyboard focus — never on touch — in a portal,
clamped to the viewport and flipped below the element when there's no room above. Labels
may wrap (max 240px) and update live if the attribute changes while shown. Don't add a
`title` as well — it would show a second, native tooltip. Don't build tooltips with CSS
`::after`; they get clipped by `overflow` parents and the window edge.

**Floating boxes:** for anything richer (e.g. the connection details card), wrap the
content in `<Floating anchor={el} open={…} placement="top">`. It renders in a portal
(inside the fullscreen element when the anchor is in one), positions with
`placeFloating()` from `lib/floating.ts`, and re-measures on content change, resize and
scroll. Provide a touch alternative to hover (tap to toggle) yourself.

---

## Popover Menus

### Standard Popover

Render popovers through `<Floating anchor={buttonEl} open={…} zClass="z-50">` — it
positions above the trigger (flipping below when needed) and keeps the box on screen, so
there's no separate mobile variant and no `absolute bottom-full …` positioning. The card:

```
bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600
rounded-xl shadow-2xl p-4 w-[340px] max-w-[calc(100vw-1rem)] max-h-[70vh] overflow-y-auto
```

Use `zClass="z-50"` for popovers (so modals they open, `z-[60]`, sit above them); the
default `z-[70]` is for tooltips and hover cards.

### Compact Dropdown Menu

```
absolute bottom-full mb-1 right-0
bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600
rounded-lg shadow-lg py-1 min-w-[140px] z-50
```

**Menu header:** `px-2 py-1 text-[10px] text-zinc-500 uppercase`

**Menu item:**
```
w-full text-left px-3 py-1.5 text-xs
text-zinc-700 dark:text-zinc-300
hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors
```

**Selected item:** add `text-indigo-500 dark:text-indigo-400 font-medium`

**Divider:** `border-t border-zinc-200 dark:border-zinc-600 mx-2 my-1`

### Center-Aligned Popover

```
absolute bottom-full mb-2 left-1/2 -translate-x-1/2
```

(Same bg/border/shadow as above)

### Close Behavior
1. One `openPopover` state in `RoomPage`; a document click listener (registered via
   `setTimeout(…, 0)` so the opening click doesn't close it) sets it to `null`.
2. Inside a popover: `onClick={(e) => e.stopPropagation()}` — this still works through
   `<Floating>`'s portal, because React listens on the portal container.
3. A menu item that opens another popover must stop propagation too, or the outside-click
   handler closes the popover it just opened.

---

## Form Controls

### Select

```
w-full px-2 py-1.5 rounded-lg
bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white
border border-zinc-300 dark:border-zinc-600 text-xs
focus:border-indigo-500 outline-none
```

### Text Input

```
w-full px-3 py-2 rounded-lg
bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white
border border-zinc-300 dark:border-zinc-600
focus:outline-none focus:ring-2 focus:ring-indigo-500
```

Compact (popover): `px-2 py-1.5 text-xs focus:border-indigo-500 outline-none`

### Range Slider

```
flex-1 h-1 accent-indigo-500 cursor-pointer
```

Container: `flex items-center gap-2`

### Label

```
block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1
```

Use `mb-1.5` when followed by grouped sub-elements (e.g. hotkey rows).

---

## Toasts, Vote Card & Jail

No inline banners — nothing above the grid pushes the layout around.

### Toasts — `useToasts` + `Toasts`

One stack, top-centre of the stage just under the header (`absolute top-[4.25rem]
inset-x-4 z-30`, `aria-live="polite"`), frosted (`bg-white/85 dark:bg-zinc-800/85
backdrop-blur-xl border rounded-xl shadow-lg text-[13px]`), `fadeSlideIn` on entry.

- Tones: `info` (neutral border), `success` (green), `warn` (amber), `error` (red) —
  the tone sets border and text colour together, so never add a second border class.
- Timing: info/success 4 s, warn 5 s, error 6 s; at most 4 shown (oldest non-sticky goes).
- **State toasts** (`sticky` + `key`) last as long as the state: "Reconnecting…", "You're
  muted". Push in an effect while the state holds and `dismiss(key)` in its cleanup.
- Errors and sticky toasts get an ✕; `onDismiss` runs when the person closes one.
- Use them for errors, joins, soundboard plays (others' only), vote results, jail news.

### Vote Card — `VoteCard`

Docked above the control bar in the same bottom dock (`absolute bottom-4 inset-x-4 z-30
flex flex-col items-center gap-2 pointer-events-none`; children `pointer-events-auto`),
so a wrapped bar pushes it up instead of overlapping. `max-w-[460px]`, amber border.
Countdown (mono, tabular), tally bar (yes from the left, no from the right), "needs N of M",
then the two ballots. "Yes" is the action and takes its colour: **Jail** red / Keep plain
for a jail vote; **Release** green / Keep in jail plain for a release vote.

### Jail

- In jail: header pill `Jailed · 4:32 left` (`bg-red-500/15 text-red-600`) plus "Back in
  X when it ends" from `lg`.
- People jailed from this room: orange header pill (`Gavel`, "Jordan in jail" / "2 in
  jail") opening a list with each countdown and **Vote to release** (anyone in the room —
  there is no instant lift). When a vote can't start, the list says why.
- Countdowns tick in their own small component (`useNow`) so the header doesn't re-render.
  Parse server times with `sqliteUtcToMs` / `secondsUntil` (ISO form; SQLite's
  space-separated timestamps aren't parsed reliably everywhere).

---

## Typography

| Purpose | Classes |
|---------|---------|
| App title | `text-lg font-bold` |
| Section header | `text-xs font-semibold uppercase text-zinc-500` |
| Dialog title | `text-sm font-semibold text-zinc-900 dark:text-white` |
| Body text | `text-sm` |
| Secondary text | `text-xs text-zinc-600 dark:text-zinc-400` |
| Tiny text | `text-[10px]` |
| Monospace (keys) | `font-mono text-xs` |
| Button label | `text-sm font-medium` |
| Section label (popover) | `text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1` |
| Small metadata | `text-[10px] text-zinc-500 dark:text-zinc-400` |

---

## Icon Sizing (Lucide React)

| Context | Size prop |
|---------|-----------|
| Control bar buttons | `size={18}` |
| Participant cards | `size={14}` |
| Sidebar/settings | `size={14}` |
| Inline (small) | `size={12}` |

Responsive label: `<span className="hidden sm:inline ml-1">Label</span>`

---

## Layout

### Page Structure

```
h-screen overflow-hidden flex
```

### Left Rail (Rooms) — `RoomRail`

Three widths, chosen with `useMediaQuery`:
- **lg+ (≥1024px):** `w-60`, room rows with a member avatar stack (max 5 + "+N"), the
  speaking member ringed `ring-blue-400`; active room `bg-indigo-500/15` with an inset
  left bar (`shadow-[inset_3px_0_0_var(--color-indigo-500)]`), jail room the red variant.
- **md–lg (768–1023px):** `w-16` icon rail — room badges with a member-count bubble,
  names in tooltips; user card stacked vertically.
- **< md:** `w-64` slide-in drawer (`fixed … z-40`, backdrop `bg-black/50 z-30`).

User card (bottom): avatar, name/@username, `SignalStrength`, E2EE lock, log out.

### Side Panel (People / Chat) — `SidePanel`, `PeopleList`, `ChatPanel`

`w-72 max-w-[85vw]`. From 1080px it's a column beside the stage and opens by default
(choice remembered in `localStorage`); below 1080px it's an overlay drawer
(`fixed inset-y-0 right-0 z-40 shadow-2xl` + `bg-black/40` backdrop) that starts closed.
Tabs: **People** (default; In this room / Elsewhere / Offline, with per-person volume and
mute-for-me) and **Chat**. Both tabs stay mounted while the panel is open (inactive one
`hidden`) so a draft survives a tab switch. The header's People button and the bar's Chat
button open their tab, or close the panel if that tab is already showing.

### Chat

- **Tile bubbles** (`ChatBubbles`): inside the tile, top-left (`right-[38%]` leaves room for
  the actions); at most the last 2 lines, each `line-clamp-2`, older one `opacity-70`; a
  `+N more · view messages` chip opens the Chat tab. Own messages `bg-blue-600/90`, others
  `bg-green-600/90`. Each line disappears after 15 s.
- **Chat tab** (`ChatPanel`): every message since joining, grouped by sender (3-min gap),
  sticks to the newest unless scrolled up; client-side only, cleared on room switch.
  The server deletes chat images 60 s after upload, so an image entry swaps to an
  "Image expired" placeholder (`ImageOff`, no link) 55 s after it arrived.
- **Composer** (`ChatComposer`): attach or paste one image + up to 200 chars; upload
  progress on the thumbnail, errors (upload or send) shown above the input.
- Unread count on the Chat tab and the bar's Chat button while the tab isn't visible.

### Avatars

Use `avatarColor(userId)` (`lib/utils.ts`) for every user avatar so the same person has
the same colour everywhere; offline users use `bg-zinc-500`.

### Main Content

```
flex-1 flex flex-col min-h-0
```

Header: `h-14 px-3 md:px-6 border-b flex items-center`
Body: `flex-1 overflow-y-auto p-4 md:p-6`

### Participant Grid

Fit-to-stage, never `grid-cols-*` breakpoints: the grid region (`relative flex-1
min-h-[200px]`, with an `absolute inset-0 overflow-y-auto` scroller inside so content can't
change its size) is measured with `useElementSize`, and `layoutGrid()` (`lib/gridLayout.ts`)
picks the column count that makes 16:9 tiles largest. Columns are fixed-width
(`repeat(n, Wpx)`, `gap-3`, `p-1` so speaking rings aren't clipped); below a 180px tile it
switches to scrolling.

### Theater — `TheaterLayout`, `PinnedView`

One pinned video fills the same measured region; everyone else sits in a filmstrip —
a side column (`w-[clamp(160px,18%,240px)]`) when the region is ≥720px wide and wider than
1.25:1, otherwise a bottom row (`h-[clamp(96px,22%,132px)]`, tiles `h-full aspect-video`).
Strip tiles are `ParticipantTile compact` (no camera PIP); the pinned person comes first
with the pinned source hidden (`hide`), so their tile shows their other video or avatar
plus a green `Monitor` in the name tag when it's their share that's on the stage.

`PinnedView`: black, `rounded-xl` (square in fullscreen), media `object-contain`; name tag
bottom-left ("Sam · screen"), `TileAction`s top-right (stream audio, fullscreen, unpin),
the other video as a PIP bottom-right (click to swap). Pin with a tile's media or its Pin
action; the header's Grid / Theater switch picks something to pin (a share first, then a
speaker's camera). Remote shares auto-pin while nothing is pinned; going back to the grid
keeps the shares showing at that moment out of auto-pin.

**Fullscreen** is the pinned view only (header button, the tile action, or double-click).
Use `lib/fullscreen.ts` (`enterFullscreen` / `getFullscreenElement` /
`onFullscreenChange`, which cover Safari's webkit API; on iPhone the video itself goes
fullscreen) or `useFullscreen(el)`. In fullscreen the controls and cursor fade after 2 s
still (`useIdle`; always shown on touch), and toasts plus the vote card render inside the
pinned view, since nothing else on the page is visible.

### Participant Tile

Full-bleed 16:9 media (`rounded-xl overflow-hidden`), no card padding or footer:
- **Name tag** bottom-left: `bg-black/55 backdrop-blur-sm text-white text-xs rounded-md`
  with status icons (`size={12}`; mic off / deafened / muted-for-me in `text-red-400`).
- **Actions** top-right: `TileAction` buttons (`w-7 h-7 bg-black/55`, red when "on"), shown
  on hover/focus, always on touch (`[@media(hover:none)]:opacity-100`), and kept visible
  while one of their popovers is open. A Pin action leads whenever the tile shows video.
  Their container stops click propagation so actions never pin the tile. Tile popovers
  open with `placement="bottom"`.
- **Camera PIP** bottom-right when a share fills the tile (not on compact strip tiles).
- Tile is a size container (`@container`) — scale avatars/text with `@max-[260px]:` etc.

### Control Bar

Docked to the stage: the room's bottom dock (`absolute bottom-4 inset-x-4 z-30 flex-col
items-center`, under the vote card) inside `<main class="relative">`, so it's centred on
the stage, not the window. `ControlBar` itself has no positioning. One row of `ControlButton`s (`p-2.5 rounded-lg`, tones: neutral /
danger / success). Never hide buttons to save space — the full row fits at every width the
side panels allow; `flex-wrap` is only a fallback. Chat is a button here (tone `accent`
while the Chat tab is showing, unread badge otherwise) — typing happens in the Chat tab.
The participant area reserves `pb-24` beneath the bar.

---

## Z-Index Layers

| Layer | Z-Index | Usage |
|-------|---------|-------|
| In-card overlays | `z-10` | PIP video, whisper badges |
| Control bar, toasts, backdrops | `z-30` | Bottom dock (bar + vote card), toast stack, mobile overlays |
| Sidebars (mobile) | `z-40` | Slide-in panels |
| All popovers/menus | `z-50` | Settings, dropdowns |
| Full-screen modals | `z-[60]` | Portal modals (clip trimmer, etc.) |
| Floating layer | `z-[70]` | Tooltips and cards rendered by `<Floating>` (above modals) |

---

## State Indicators

### Online/Offline Dot

```
absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
border-2 border-white dark:border-zinc-800
```

Online: `bg-green-500` | Offline: (element hidden)

### Speaking Indicator

```
w-1.5 h-1.5 rounded-full shrink-0 transition-colors
```

Speaking: `bg-blue-400 shadow-[0_0_4px_rgba(96,165,250,0.8)]`
Quiet: `bg-green-500`

### Active Speaker Glow (Card)

```
ring-2 ring-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.5)]
```

Non-speaking: `ring-2 ring-indigo-500/30`

### Connection Signal Bars

```
flex items-end gap-[2px]
```

Each bar: `w-[3px] rounded-sm transition-colors duration-100`

| Quality | Color |
|---------|-------|
| Excellent/Good | `bg-green-500` |
| Fair | `bg-yellow-500` |
| Poor | `bg-orange-500` |
| Bad | `bg-red-500` |
| Inactive | `bg-zinc-600` |

### Mic Level Meter

Container: `h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden`

Fill: `transition-[width] duration-75`
- Normal: `bg-green-500`
- Medium (>30%): `bg-yellow-500`
- Loud (>60%): `bg-red-500`

---

## Animations & Transitions

| Effect | Classes |
|--------|---------|
| Button hover | `transition-colors` |
| Error fade-out | `transition-opacity duration-500` |
| Sidebar slide | `transition-transform duration-200 ease-in-out` |
| Mic level bar | `transition-[width] duration-75` |
| Signal bar change | `transition-colors duration-100` |
| Hotkey rebinding | `animate-pulse` |
| Error fade-in | `animate-[fadeIn_0.2s_ease-out]` |

---

## Responsive Breakpoints

| Breakpoint | Width | Common usage |
|------------|-------|--------------|
| (default) | < 640px | Single column, compact, icons only |
| `sm:` | 640px+ | 2-col grid, show button labels |
| `md:` | 768px+ | Sidebars become static, wider padding |
| `lg:` | 1024px+ | 3-col grid |
| `xl:` | 1280px+ | 4-col grid |

---

## Mobile Backdrop

```
fixed inset-0 bg-black/50 z-30 md:hidden
```

Used for: sidebar overlays. Always include `onClick={onClose}`.

---

## Fullscreen / Safe-Area Positioning

- Never use fixed pixel offsets for fullscreen controls — they break across resolutions and bezels
- Use `env(safe-area-inset-bottom)` combined with viewport-relative units:
  ```
  bottom: calc(env(safe-area-inset-bottom, 0px) + 3vh)
  ```
- `viewport-fit=cover` must be set on the viewport meta tag for `env()` to report values
- Non-fullscreen overlays can use fixed offsets (e.g. `0.5rem`)

---

## Spacing

- Between sections: `space-y-4`
- Label to control: `mb-1` or `mb-1.5`
- Within groups: `gap-1.5`

---

## Dark Mode

All components use inline `dark:` variants. Theme is toggled via `.dark` class on the document root, persisted in localStorage.

Every background, text, and border class must have a `dark:` counterpart. Pattern:
```
bg-white dark:bg-zinc-800
text-zinc-900 dark:text-white
border-zinc-200 dark:border-zinc-700
hover:bg-zinc-300 dark:hover:bg-zinc-600
```

---

## Participant Card

```
bg-white dark:bg-zinc-800 rounded-xl p-4
border border-zinc-200 dark:border-zinc-700
ring-2 transition-shadow
```

Avatar (no video): `w-16 h-16 rounded-full bg-indigo-600 text-white text-2xl font-bold`

Room avatar (sidebar): `w-7 h-7 rounded-md bg-indigo-600 text-white text-xs font-bold`

---

## Tooltip

```
absolute bottom-full mb-2 left-1/2 -translate-x-1/2
bg-zinc-900 border border-zinc-700 rounded-lg
px-3 py-2 text-xs text-zinc-300 whitespace-nowrap z-50 shadow-lg
```

Arrow: CSS border-triangle pointing down
```
border-l-4 border-r-4 border-t-4 border-transparent border-t-zinc-700
```

---

## Full-Screen Modal (Portal)

Used for complex interactions that need to escape popover/panel containers (e.g. clip trimmer).

**Rendered via `createPortal(…, document.body)` to escape parent overflow/positioning.**

### Backdrop

```
fixed inset-0 bg-black/50 z-[60] flex items-center justify-center
```

- `z-[60]` — above all popovers (`z-50`)
- Click backdrop to dismiss (`onClick={onCancel}`)

### Panel

```
bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600
rounded-xl shadow-2xl p-4 w-[min(520px,calc(100vw-2rem))]
```

Inner panel: `onClick={(e) => e.stopPropagation()}`

### Dialog Title

```
text-sm font-semibold text-zinc-900 dark:text-white mb-3
```

### Button Row

```
flex items-center gap-2 mt-3
```

- Primary action (right): `bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 text-xs font-medium rounded-lg`
- Secondary/cancel (right): `bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-2.5 py-1 text-xs font-medium rounded-lg`
- Utility (left): same as secondary
- Spacer between left/right groups: `<div className="flex-1" />`

### Dismiss

- Escape key listener: `window.addEventListener('keydown', …)`
- Backdrop click: fires `onCancel`
