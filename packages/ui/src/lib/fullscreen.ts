// Element fullscreen across browsers: the standard API, Safari's webkit-prefixed one, and
// iPhone Safari, which can only fullscreen a <video> (in the system player).

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
