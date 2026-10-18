import { useCallback, useEffect, useState } from 'react';
import { enterFullscreen, exitFullscreen, getFullscreenElement, onFullscreenChange } from '../lib/fullscreen';

/** Whether `el` is fullscreen, and a toggle for it. */
export function useFullscreen(el: HTMLElement | null) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const update = () => setIsFullscreen(!!el && getFullscreenElement() === el);
    update();
    return onFullscreenChange(update);
  }, [el]);

  const toggle = useCallback(() => {
    if (!el) return;
    if (getFullscreenElement() === el) exitFullscreen();
    else enterFullscreen(el);
  }, [el]);

  return { isFullscreen, toggle };
}
