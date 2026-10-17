import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeFloating, type Placement } from '../lib/floating';

interface FloatingProps {
  /** Element the box is positioned against. */
  anchor: HTMLElement | null;
  open: boolean;
  placement?: Placement;
  className?: string;
  role?: string;
  /** Stacking layer: tooltips/cards default to z-[70]; popovers use z-50 so modals
   *  they open (z-[60], e.g. the clip trimmer) sit above them. */
  zClass?: string;
  children: ReactNode;
}

/**
 * Renders children in a portal, positioned next to `anchor` and kept inside the
 * viewport — so it's never clipped by a scrolling or overflow-hidden parent, or the
 * window edge. Re-measures when the content changes, on resize and on scroll.
 */
export function Floating({ anchor, open, placement = 'top', className = '', role, zClass = 'z-[70]', children }: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const update = () => {
      if (!ref.current) return;
      setPos(placeFloating(anchor.getBoundingClientRect(), ref.current.getBoundingClientRect(), placement));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchor, placement, children]);

  if (!open || !anchor) return null;
  // In fullscreen only the fullscreen element is visible — render inside it when the
  // anchor is part of it (e.g. screen-share controls), otherwise into <body>.
  const fs = document.fullscreenElement
    ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
    ?? null;
  const container = fs && fs.contains(anchor) ? fs : document.body;
  return createPortal(
    <div
      ref={ref}
      role={role}
      className={`fixed ${zClass} ${className}`}
      // Rendered off-screen for one measuring pass before the real position is known
      style={pos ?? { top: -9999, left: -9999, visibility: 'hidden' as const }}
    >
      {children}
    </div>,
    container,
  );
}
