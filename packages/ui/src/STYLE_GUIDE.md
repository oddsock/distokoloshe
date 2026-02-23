# UI Style Guide

**Source of truth:** `DeviceSettings.tsx`

All popup panels, modals, and overlays should follow these conventions.

## Popup Containers
- Background: `bg-white dark:bg-zinc-800`
- Border: `border border-zinc-200 dark:border-zinc-600`
- Radius: `rounded-xl`
- Shadow: `shadow-2xl`
- Padding: `p-4`
- Z-index: `z-50`
- Desktop position: `absolute bottom-full mb-2 right-0`
- Mobile position: `fixed bottom-16 left-2 right-2 max-h-[70vh] overflow-y-auto`
- Stop propagation: `onClick={(e) => e.stopPropagation()}`

## Typography
- Panel title: `text-sm font-semibold text-zinc-900 dark:text-white mb-3`
- Section label: `text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1`
- Small metadata: `text-[10px] text-zinc-500 dark:text-zinc-400`

## Inputs & Selects
- `w-full px-2 py-1.5 rounded-lg text-xs`
- `bg-zinc-100 dark:bg-zinc-700`
- `text-zinc-900 dark:text-white`
- `border border-zinc-300 dark:border-zinc-600`
- Focus: `focus:border-indigo-500 outline-none`

## Buttons
- Primary: `bg-indigo-600 text-white hover:bg-indigo-500 rounded-lg px-2.5 py-1 text-xs font-medium`
- Primary disabled: append `opacity-50 cursor-not-allowed`
- Secondary: `bg-zinc-100 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-500 hover:border-indigo-500 rounded text-[10px] font-medium`

## Spacing
- Between sections: `space-y-4`
- Label to control: `mb-1` or `mb-1.5`
- Within groups: `gap-1.5`

## Fullscreen / Safe-Area Positioning
- Never use fixed pixel offsets for fullscreen controls — they break across resolutions and bezels
- Use `env(safe-area-inset-bottom)` combined with viewport-relative units:
  ```
  bottom: calc(env(safe-area-inset-bottom, 0px) + 3vh)
  ```
- `viewport-fit=cover` must be set on the viewport meta tag for `env()` to report values
- Non-fullscreen overlays can use fixed offsets (e.g. `0.5rem`)

## Colors
- Accent: `indigo-600` (primary actions), `indigo-500` (hover/active states)
- Danger: `red-500` / `red-400`
- Success: `green-500`
