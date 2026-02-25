import { useEffect, useState, useCallback, useRef } from 'react';

export interface HotkeyBindings {
  toggleMute: string;
  toggleDeafen: string;
}

const HOTKEYS_KEY = 'distokoloshe_hotkeys';

const DEFAULT_BINDINGS: HotkeyBindings = {
  toggleMute: 'KeyM',
  toggleDeafen: 'KeyD',
};

const isTauri = () => '__TAURI_INTERNALS__' in window;

// ── Binding parsing ──────────────────────────────────────
// Format: "Ctrl+Alt+KeyM" or "KeyM" (no modifiers)

interface ParsedBinding {
  mods: string[]; // e.g. ['Ctrl', 'Alt']
  key: string;    // e.g. 'KeyM'
}

function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split('+');
  return {
    key: parts[parts.length - 1],
    mods: parts.slice(0, -1),
  };
}

function matchesKeyEvent(binding: string, e: KeyboardEvent): boolean {
  const { key, mods } = parseBinding(binding);
  return (
    e.code === key &&
    e.ctrlKey === mods.includes('Ctrl') &&
    e.altKey === mods.includes('Alt') &&
    e.shiftKey === mods.includes('Shift') &&
    e.metaKey === mods.includes('Meta')
  );
}

// Convert our format to Tauri global shortcut format
// "Ctrl+Alt+KeyM" → "CmdOrControl+Alt+M"
function toTauriShortcut(binding: string): string {
  return binding
    .replace('Ctrl', 'CmdOrControl')
    .replace(/Key([A-Z])/g, '$1')
    .replace(/Digit(\d)/g, '$1')
    .replace('Space', 'Space')
    .replace('Backquote', '`')
    .replace('Minus', '-')
    .replace('Equal', '=')
    .replace('BracketLeft', '[')
    .replace('BracketRight', ']')
    .replace('Backslash', '\\')
    .replace('Semicolon', ';')
    .replace('Quote', "'")
    .replace('Comma', ',')
    .replace('Period', '.')
    .replace('Slash', '/');
}

function hasModifiers(binding: string): boolean {
  return binding.includes('+');
}

// ── Public API ───────────────────────────────────────────

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

export function formatKey(binding: string): string {
  const parts = binding.split('+');
  const formatted = parts.map((part) => {
    if (part === 'Ctrl' || part === 'Alt' || part === 'Shift' || part === 'Meta') return part;
    if (part.startsWith('Key')) return part.slice(3);
    if (part.startsWith('Digit')) return part.slice(5);
    const map: Record<string, string> = {
      Space: 'Space', Backquote: '`', Minus: '-', Equal: '=',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    };
    return map[part] || part;
  });
  return formatted.join(' + ');
}

interface UseHotkeysOptions {
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  enabled: boolean;
}

export function useHotkeys({ onToggleMute, onToggleDeafen, enabled }: UseHotkeysOptions) {
  const [bindings, setBindingsState] = useState<HotkeyBindings>(loadHotkeys);
  const registeredRef = useRef<string[]>([]);
  const callbacksRef = useRef({ onToggleMute, onToggleDeafen });
  callbacksRef.current = { onToggleMute, onToggleDeafen };

  const setBindings = useCallback((next: HotkeyBindings) => {
    setBindingsState(next);
    saveHotkeys(next);
  }, []);

  // ── Browser keydown handler (works in both Tauri and browser) ──
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (matchesKeyEvent(bindings.toggleMute, e)) {
        e.preventDefault();
        onToggleMute();
      } else if (matchesKeyEvent(bindings.toggleDeafen, e)) {
        e.preventDefault();
        onToggleDeafen();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, bindings, onToggleMute, onToggleDeafen]);

  // ── Tauri global shortcuts (only for bindings WITH modifiers) ──
  useEffect(() => {
    if (!isTauri() || !enabled) return;

    let cancelled = false;

    const setup = async () => {
      const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');

      // Unregister any previously registered shortcuts
      for (const shortcut of registeredRef.current) {
        try { await unregister(shortcut); } catch { /* ignore */ }
      }
      registeredRef.current = [];

      if (cancelled) return;

      const entries: [string, () => void][] = [
        [bindings.toggleMute, () => callbacksRef.current.onToggleMute()],
        [bindings.toggleDeafen, () => callbacksRef.current.onToggleDeafen()],
      ];

      for (const [binding, callback] of entries) {
        // Only register global shortcuts for bindings with modifiers
        // Single keys (e.g. 'M') would fire while typing in other apps
        if (!hasModifiers(binding)) continue;

        const shortcut = toTauriShortcut(binding);
        try {
          await register(shortcut, (event) => {
            // Tauri fires on both keydown ("Pressed") and keyup ("Released")
            if (event.state !== 'Pressed') return;
            callback();
          });
          registeredRef.current.push(shortcut);
        } catch (err) {
          console.warn(`Failed to register global shortcut ${shortcut}:`, err);
        }
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (!isTauri()) return;
      import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) => {
        for (const shortcut of registeredRef.current) {
          unregister(shortcut).catch(() => {});
        }
        registeredRef.current = [];
      });
    };
  }, [enabled, bindings]);

  return { bindings, setBindings };
}
