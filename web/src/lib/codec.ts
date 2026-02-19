/** Detect if the browser supports AV1 encoding for WebRTC */
export function detectAV1Encode(): boolean {
  if (!('RTCRtpSender' in window)) return false;
  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities) return false;
  return capabilities.codecs.some(
    (c) => c.mimeType.toLowerCase() === 'video/av1',
  );
}

/** Detect if the browser supports AV1 decoding for WebRTC */
export function detectAV1Decode(): boolean {
  if (!('RTCRtpReceiver' in window)) return false;
  const capabilities = RTCRtpReceiver.getCapabilities('video');
  if (!capabilities) return false;
  return capabilities.codecs.some(
    (c) => c.mimeType.toLowerCase() === 'video/av1',
  );
}

/** More granular check using WebCodecs API for hardware AV1 decode */
export async function detectAV1HardwareDecode(): Promise<boolean> {
  if (!('VideoDecoder' in window)) return false;
  try {
    const result = await (VideoDecoder as unknown as {
      isConfigSupported(config: { codec: string; hardwareAcceleration: string }): Promise<{ supported: boolean }>;
    }).isConfigSupported({
      codec: 'av01.0.08M.08', // Main profile, level 4.0, 8-bit
      hardwareAcceleration: 'prefer-hardware',
    });
    return result.supported === true;
  } catch {
    return false;
  }
}
