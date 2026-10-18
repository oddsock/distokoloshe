import { useEffect, useState } from 'react';

/**
 * True once the pointer has rested over `el` for `ms` while `active` — for fading
 * fullscreen controls. Moving the pointer, tapping or pressing a key wakes it.
 */
export function useIdle(el: HTMLElement | null, active: boolean, ms = 2000): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!el || !active) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    wake();
    el.addEventListener('pointermove', wake);
    el.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', wake);
      el.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
    };
  }, [el, active, ms]);

  return idle;
}
