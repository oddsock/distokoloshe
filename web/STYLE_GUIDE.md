# disTokoloshe Web — UI Style Guide

Reference for maintaining consistent styling across all components. When adding new buttons, menus, or features, follow the patterns documented here.

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
| **Amber** | Warnings, error banners | `bg-amber-50 dark:bg-zinc-800 text-amber-700 dark:text-amber-200` |
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

Sizes: `px-3 py-2 text-sm` (standard) | `py-2 px-4 text-base` (form submit)

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

## Popover Menus

### Standard Popover (above trigger)

**Desktop:**
```
absolute bottom-full mb-2 right-0
bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600
rounded-xl shadow-2xl p-4 w-[340px] z-50
```

**Mobile (full-width bottom sheet):**
```
fixed bottom-16 left-2 right-2
bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600
rounded-xl shadow-2xl p-4 z-50 max-h-[70vh] overflow-y-auto
```

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

1. Add document click listener with `setTimeout(() => ..., 0)` to defer past the opening click
2. Inside popover: `onClick={(e) => e.stopPropagation()}`
3. Outside click: set state to false

---

## Form Controls

### Select

```
w-full px-2 py-1.5 rounded-lg
bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white
border border-zinc-300 dark:border-zinc-600 text-xs
```

### Text Input

```
w-full px-3 py-2 rounded-lg
bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white
border border-zinc-300 dark:border-zinc-600
focus:outline-none focus:ring-2 focus:ring-indigo-500
```

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

## Error/Toast Banners

### Standard Error Banner

```
mb-4 p-3 rounded-lg text-sm flex items-center
bg-amber-50 dark:bg-zinc-800
border border-amber-500/40
text-amber-700 dark:text-amber-200
```

**Auto-dismiss timing:**
- Visible: 4.5 seconds
- Fade-out: `transition-opacity duration-500` then `opacity-0`
- Remove from DOM: 5 seconds total

**Close button:**
```
ml-2 text-amber-500 dark:text-amber-400
hover:text-amber-700 dark:hover:text-amber-200
```

### Vote Result Toast

- Passed: `bg-red-500/20 border border-red-500/50 text-red-300`
- Failed: `bg-green-500/20 border border-green-500/50 text-green-300`
- Auto-dismiss: 4 seconds

### Banner Pattern

All banners follow: `mb-4 p-3 bg-{color} border border-{color} rounded-lg text-sm`

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

### Left Sidebar (Rooms)

```
w-60 bg-white dark:bg-zinc-800
border-r border-zinc-200 dark:border-zinc-700
flex flex-col
```

Header: `h-14 px-3 border-b flex items-center justify-between`
List: `flex-1 overflow-y-auto p-2`
Footer: `h-16 px-3 border-t flex items-center`

### Right Sidebar (Users)

```
w-52 bg-white dark:bg-zinc-800
border-l border-zinc-200 dark:border-zinc-700
flex flex-col
```

Mobile: `fixed inset-y-0 right-0 z-40 transform transition-transform duration-200 ease-in-out`

### Main Content

```
flex-1 flex flex-col min-h-0
```

Header: `h-14 px-3 md:px-6 border-b flex items-center`
Body: `flex-1 overflow-y-auto p-4 md:p-6`

### Participant Grid

```
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4
```

### Floating Control Bar

```
fixed bottom-4 left-1/2 -translate-x-1/2 z-30
flex flex-wrap items-center justify-center gap-2 md:gap-3
bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl
rounded-2xl px-4 py-2.5 shadow-lg
border border-zinc-200/50 dark:border-zinc-700/50
```

---

## Z-Index Layers

| Layer | Z-Index | Usage |
|-------|---------|-------|
| In-card overlays | `z-10` | PIP video, whisper badges |
| Control bar, backdrops | `z-30` | Floating bar, mobile overlays |
| Sidebars (mobile) | `z-40` | Slide-in panels |
| All popovers/menus | `z-50` | Settings, dropdowns, tooltips |

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
