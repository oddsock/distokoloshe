export type Placement = 'top' | 'bottom';

const GAP = 8;    // between anchor and floating box
const MARGIN = 8; // minimum distance from the viewport edge

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Viewport position for a floating box (tooltip, card, popover) next to an anchor:
 * on the preferred side if it fits, otherwise flipped, and always clamped so the whole
 * box stays on screen. Coordinates are for `position: fixed`.
 */
export function placeFloating(
  anchor: DOMRect,
  size: { width: number; height: number },
  placement: Placement = 'top',
): { top: number; left: number } {
  const above = anchor.top - GAP - size.height;
  const below = anchor.bottom + GAP;
  const fitsAbove = above >= MARGIN;
  const fitsBelow = below + size.height <= window.innerHeight - MARGIN;
  const top = placement === 'top'
    ? (fitsAbove || !fitsBelow ? above : below)
    : (fitsBelow || !fitsAbove ? below : above);
  return {
    top: clamp(top, MARGIN, window.innerHeight - size.height - MARGIN),
    left: clamp(anchor.left + anchor.width / 2 - size.width / 2, MARGIN, window.innerWidth - size.width - MARGIN),
  };
}
