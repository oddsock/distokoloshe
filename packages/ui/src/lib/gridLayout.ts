export interface GridLayout {
  columns: number;
  /** Tile width in px (tiles are 16:9) */
  tileWidth: number;
  /** True when even the best fit was below the minimum — tiles keep `minWidth` and the grid scrolls */
  scroll: boolean;
}

const ASPECT = 16 / 9;

/**
 * Lay out `count` 16:9 tiles in a `width`×`height` box with `gap` between them: the column
 * count that makes tiles as large as possible while everything fits. If the best fit is
 * narrower than `minWidth`, fill the width with `minWidth`-ish tiles and let it scroll.
 */
export function layoutGrid(count: number, width: number, height: number, gap: number, minWidth = 180): GridLayout {
  const n = Math.max(1, count);
  let best: GridLayout = { columns: 1, tileWidth: 0, scroll: false };
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const byWidth = (width - gap * (columns - 1)) / columns;
    const byHeight = ((height - gap * (rows - 1)) / rows) * ASPECT;
    const tileWidth = Math.floor(Math.min(byWidth, byHeight));
    if (tileWidth > best.tileWidth) best = { columns, tileWidth, scroll: false };
  }
  if (best.tileWidth >= minWidth) return best;

  const columns = Math.max(1, Math.min(n, Math.floor((width + gap) / (minWidth + gap))));
  return { columns, tileWidth: Math.floor((width - gap * (columns - 1)) / columns), scroll: true };
}
