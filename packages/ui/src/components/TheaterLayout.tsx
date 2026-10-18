import type { ReactNode } from 'react';

interface TheaterLayoutProps {
  /** The measured stage region */
  width: number;
  height: number;
  /** The pinned item */
  main: ReactNode;
  /** Everyone else, as compact tiles */
  strip: Array<{ key: string; node: ReactNode }>;
}

/**
 * Theater: the pinned item fills the stage; the rest sit in a filmstrip — down the side
 * on wide stages, along the bottom on narrow or tall ones. The strip scrolls if it's full.
 */
export function TheaterLayout({ width, height, main, strip }: TheaterLayoutProps) {
  const side = width >= 720 && width / Math.max(height, 1) >= 1.25;
  return (
    <div className={`absolute inset-0 flex gap-3 ${side ? 'flex-row' : 'flex-col'}`}>
      <div className="flex-1 min-w-0 min-h-0">{main}</div>
      {strip.length > 0 && (
        <div
          className={
            side
              ? 'w-[clamp(160px,18%,240px)] shrink-0 overflow-y-auto flex flex-col gap-2.5 p-1'
              : 'h-[clamp(96px,22%,132px)] shrink-0 overflow-x-auto flex flex-row gap-2.5 p-1'
          }
        >
          {strip.map(({ key, node }) => (
            <div key={key} className={side ? 'shrink-0 w-full' : 'shrink-0 h-full aspect-video'}>
              {node}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
