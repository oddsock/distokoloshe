import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createHmac } from 'crypto';
import db from './db.js';

export async function generateRoomToken(
  identity: string,
  displayName: string,
  roomName: string,
  userId?: number,
): Promise<string> {
  // Build participant metadata
  const metadata: Record<string, unknown> = {};
  if (userId) {
    const settings = db.prepare('SELECT soundbite_opt_out FROM user_settings WHERE user_id = ?').get(userId) as { soundbite_opt_out: number } | undefined;
    if (settings?.soundbite_opt_out) {
      metadata.soundbiteOptOut = true;
    }
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity,
      name: displayName,
      ttl: '2h',
      metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : undefined,
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
