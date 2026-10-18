// Element fullscreen across browsers: the standard API, Safari's webkit-prefixed one, and
// iPhone Safari, which can only fullscreen a <video> (in the system player). The desktop
// app doesn't use element fullscreen at all (unreliable in the macOS webview): it makes
// the window fullscreen and pins the element over it — see useFullscreen.

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** The element that's fullscreen right now, if any. */
export function getFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Make `el` fullscreen; on iPhone, its video goes fullscreen instead. */
export function enterFullscreen(el: HTMLElement): void {
  const target = el as WebkitElement;
  if (typeof target.requestFullscreen === 'function') {
    // Called synchronously (Safari needs the click's user gesture); some browsers return
    // no promise, and a refusal shouldn't throw
    try { target.requestFullscreen()?.catch?.(() => {}); } catch { /* not allowed here */ }
  } else if (typeof target.webkitRequestFullscreen === 'function') {
    target.webkitRequestFullscreen();
  } else {
    (el.querySelector('video') as WebkitVideo | null)?.webkitEnterFullscreen?.();
  }
}

export function exitFullscreen(): void {
  if (!getFullscreenElement()) return;
  const doc = document as WebkitDocument;
  if (typeof doc.exitFullscreen === 'function') {
    try { doc.exitFullscreen()?.catch?.(() => {}); } catch { /* already left */ }
  } else {
    doc.webkitExitFullscreen?.();
  }
}

/** Subscribe to fullscreen changes (standard and webkit events). Returns the unsubscribe. */
export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

async function appWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

/** Desktop app: whether the window is fullscreen. */
export async function isWindowFullscreen(): Promise<boolean> {
  try {
    return await (await appWindow()).isFullscreen();
  } catch {
    return false;
  }
}

/** Desktop app: make the window fullscreen, or not. */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    await (await appWindow()).setFullscreen(on);
  } catch (err) {
    console.warn('Window fullscreen failed:', err);
  }
}

/** Desktop app: call `cb` when the window leaves fullscreen (e.g. the green button). Returns the unsubscribe. */
export async function onWindowFullscreenExit(cb: () => void): Promise<() => void> {
  const win = await appWindow();
  return win.onResized(async () => {
    if (!(await win.isFullscreen())) cb();
  });
}
