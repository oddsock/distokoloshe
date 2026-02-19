import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createHmac } from 'crypto';

export async function generateRoomToken(
  identity: string,
  displayName: string,
  roomName: string,
): Promise<string> {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity,
      name: displayName,
      ttl: '2h',
    },
  );

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return await at.toJwt();
}

export function deriveRoomE2EEKey(roomName: string): string {
  const secret = process.env.E2EE_SECRET || process.env.JWT_SECRET!;
  const hmac = createHmac('sha256', secret);
  hmac.update(roomName);
  return hmac.digest('base64');
}

/** Kick a participant from a LiveKit room server-side */
export async function removeParticipant(roomName: string, identity: string): Promise<void> {
  const wsUrl = process.env.LIVEKIT_URL || 'ws://localhost:7881';
  // RoomServiceClient needs HTTP URL
  const httpUrl = wsUrl.replace(/^ws/, 'http');
  const svc = new RoomServiceClient(
    httpUrl,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  try {
    await svc.removeParticipant(roomName, identity);
  } catch (err) {
    console.warn(`Failed to remove participant ${identity} from ${roomName}:`, err);
  }
}
