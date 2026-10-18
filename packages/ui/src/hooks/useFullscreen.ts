import { useCallback, useEffect, useRef, useState } from 'react';
import {
  enterFullscreen, exitFullscreen, getFullscreenElement, onFullscreenChange,
  isTauri, isWindowFullscreen, setWindowFullscreen, onWindowFullscreenExit,
} from '../lib/fullscreen';

// The macOS window takes ~0.7 s to animate into fullscreen; ignore "not fullscreen" until then
const WINDOW_SETTLE_MS = 1500;

/**
 * Whether `el` is fullscreen, and a toggle for it. In the desktop app the window goes
 * fullscreen and `el` is pinned over it instead (`windowMode` — style it `fixed inset-0`);
 * Escape, or leaving the window's fullscreen any other way, ends it.
 */
export function useFullscreen(el: HTMLElement | null) {
  const [native, setNative] = useState(false);
  const [windowMode, setWindowMode] = useState(false);
  // Whether we put the window into fullscreen (so leaving should take it out again)
  const madeWindowFullscreen = useRef(false);

  useEffect(() => {
    const update = () => setNative(!!el && getFullscreenElement() === el);
    update();
    return onFullscreenChange(update);
  }, [el]);

  const leaveWindowMode = useCallback(() => {
    setWindowMode(false);
    if (madeWindowFullscreen.current) void setWindowFullscreen(false);
    madeWindowFullscreen.current = false;
  }, []);

  const enterWindowMode = useCallback(() => {
    setWindowMode(true);
    void (async () => {
      const already = await isWindowFullscreen();
      madeWindowFullscreen.current = !already;
      if (!already) await setWindowFullscreen(true);
    })();
  }, []);

  useEffect(() => {
    if (!windowMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leaveWindowMode();
    };
    window.addEventListener('keydown', onKey);
    const since = Date.now();
    let unlisten: (() => void) | undefined;
    let done = false;
    onWindowFullscreenExit(() => {
      if (Date.now() - since > WINDOW_SETTLE_MS) {
        madeWindowFullscreen.current = false; // already out
        setWindowMode(false);
      }
    }).then((u) => { if (done) u(); else unlisten = u; }).catch(() => {});
    return () => {
      done = true;
      window.removeEventListener('keydown', onKey);
      unlisten?.();
    };
  }, [windowMode, leaveWindowMode]);

  // The element went away (e.g. the last pane closed) — don't leave the window fullscreen
  useEffect(() => {
    if (!el && windowMode) leaveWindowMode();
  }, [el, windowMode, leaveWindowMode]);

  const toggle = useCallback(() => {
    if (!el) return;
    if (isTauri()) {
      if (windowMode) leaveWindowMode();
      else enterWindowMode();
    } else if (getFullscreenElement() === el) {
      exitFullscreen();
    } else {
      enterFullscreen(el);
    }
  }, [el, windowMode, enterWindowMode, leaveWindowMode]);

  return { isFullscreen: native || windowMode, windowMode, toggle };
}
