import { useEffect, useState } from 'react';
import { Floating } from './Floating';

/**
 * One app-wide tooltip for every element with a `data-tooltip="…"` attribute. It
 * renders through <Floating>, so it's clamped to the viewport and never clipped by
 * the element's parents (the old CSS ::after tooltip was). Shown for mouse hover and
 * keyboard focus only — a touch tap doesn't leave a tooltip stuck open. Mount once.
 */
export function TooltipLayer() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    let current: HTMLElement | null = null;
    let textObserver: MutationObserver | null = null;
    let detachCheck: ReturnType<typeof setInterval> | undefined;

    const hide = () => {
      current = null;
      textObserver?.disconnect();
      clearInterval(detachCheck);
      setAnchor(null);
    };
    const show = (el: HTMLElement) => {
      const label = el.dataset.tooltip;
      if (!label) return;
      hide();
      current = el;
      setText(label);
      setAnchor(el);
      // Labels change while hovered (e.g. Mute → Unmute after a hotkey)
      textObserver = new MutationObserver(() => {
        if (el.dataset.tooltip) setText(el.dataset.tooltip);
        else hide();
      });
      textObserver.observe(el, { attributes: true, attributeFilter: ['data-tooltip'] });
      // The anchor can unmount while hovered — don't leave its tooltip behind
      detachCheck = setInterval(() => {
        if (!el.isConnected) hide();
      }, 300);
    };
    const tooltipTarget = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tooltipTarget(e.target);
      if (el && el !== current) show(el);
    };
    const onPointerOut = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tooltipTarget(e.target);
      if (el && e.target instanceof Element && e.target.matches(':focus-visible')) show(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', hide); // clicking acts; the label may be stale
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  return (
    <Floating
      anchor={anchor}
      open={anchor !== null}
      role="tooltip"
      className="pointer-events-none max-w-[240px] px-2.5 py-1 rounded-md text-xs leading-snug shadow-lg bg-zinc-800 text-zinc-200 dark:bg-zinc-200 dark:text-zinc-800"
    >
      {text}
    </Floating>
  );
}
