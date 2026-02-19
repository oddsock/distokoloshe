export type VideoCodecChoice = 'av1' | 'vp9' | 'vp8';

/** Detect if the browser supports AV1 encoding for WebRTC */
export function detectAV1Encode(): boolean {
  if (!('RTCRtpSender' in window)) return false;
  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities) return false;
  return capabilities.codecs.some(
    (c) => c.mimeType.toLowerCase() === 'video/av1',
  );
}

/** Detect browser engine */
function detectEngine(): 'firefox' | 'chromium' | 'safari' | 'unknown' {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'firefox';
  // Safari check must come before Chromium — Chrome UA also contains "Safari"
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  // Chrome, Edge, Brave, Opera, etc.
  if (/Chrome\//.test(ua)) return 'chromium';
  return 'unknown';
}

/**
 * Pick the best screen share video codec for the current browser.
 *
 * Constraints:
 *   - Chromium + E2EE: AV1 not supported (Encoded Transforms can't parse AV1 frames)
 *   - Firefox + E2EE: AV1 works (uses different insertable-streams path)
 *   - Safari: no VP9 encode, no AV1 — H.264/VP8 only (backupCodec handles fallback)
 */
// LiveKit backupCodec only accepts 'vp8' or 'h264'
export type BackupCodec = 'vp8' | 'h264';

export function getScreenShareCodec(wantAV1: boolean): { codec: VideoCodecChoice; backup: BackupCodec | false } {
  const engine = detectEngine();

  // Firefox: AV1 if requested + hardware available, otherwise VP9
  if (engine === 'firefox') {
    if (wantAV1 && detectAV1Encode()) {
      return { codec: 'av1', backup: 'vp8' };
    }
    return { codec: 'vp9', backup: 'vp8' };
  }

  // Safari: no VP9 encode support — use VP8, LiveKit falls back to H.264 if needed
  if (engine === 'safari') {
    return { codec: 'vp8', backup: false };
  }

  // Chromium (Chrome, Edge, Brave, etc.): VP9 is safest, AV1+E2EE breaks
  return { codec: 'vp9', backup: 'vp8' };
}
