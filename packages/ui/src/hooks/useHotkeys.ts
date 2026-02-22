import { useEffect, useState, useCallback } from 'react';

export interface HotkeyBindings {
  toggleMute: string;
  toggleDeafen: string;
}

const HOTKEYS_KEY = 'distokoloshe_hotkeys';

const DEFAULT_BINDINGS: HotkeyBindings = {
  toggleMute: 'KeyM',
  toggleDeafen: 'KeyD',
};

export function loadHotkeys(): HotkeyBindings {
  try {
    const stored = JSON.parse(localStorage.getItem(HOTKEYS_KEY) || '{}');
    return { ...DEFAULT_BINDINGS, ...stored };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveHotkeys(bindings: HotkeyBindings) {
  localStorage.setItem(HOTKEYS_KEY, JSON.stringify(bindings));
}

export function formatKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  return map[code] || code;
}

interface UseHotkeysOptions {
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  enabled: boolean;
}

export function useHotkeys({ onToggleMute, onToggleDeafen, enabled }: UseHotkeysOptions) {
  const [bindings, setBindingsState] = useState<HotkeyBindings>(loadHotkeys);

  const setBindings = useCallback((next: HotkeyBindings) => {
    setBindingsState(next);
    saveHotkeys(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs, selects, textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === bindings.toggleMute) {
        e.preventDefault();
        onToggleMute();
      } else if (e.code === bindings.toggleDeafen) {
        e.preventDefault();
        onToggleDeafen();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, bindings, onToggleMute, onToggleDeafen]);

  return { bindings, setBindings };
}
