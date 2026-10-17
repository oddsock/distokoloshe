import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createHmac, randomBytes } from 'crypto';
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

// ── Room E2EE keys ──────────────────────────────────────────
// Each room has a random 256-bit key (rooms.e2ee_key, base64) handed to members on
// join, and replaced when LiveKit reports the room finished — see rotateRoomE2EEKey.

/** A fresh random room key (base64). */
export function newRoomE2EEKey(): string {
  return randomBytes(32).toString('base64');
}

/** The pre-random-key derivation. Only seeds rooms created before per-room keys, so
 *  calls in progress during the upgrade keep working; the first rotation replaces it. */
function legacyRoomE2EEKey(roomName: string): string {
  const secret = process.env.E2EE_SECRET || process.env.JWT_SECRET!;
  return createHmac('sha256', secret).update(roomName).digest('base64');
}

/** The room's current E2EE key. Throws if the room doesn't exist. */
export function getRoomE2EEKey(roomId: number): string {
  const row = db.prepare('SELECT name, e2ee_key FROM rooms WHERE id = ?').get(roomId) as
    { name: string; e2ee_key: string | null } | undefined;
  if (!row) throw new Error(`Room ${roomId} not found`);
  if (row.e2ee_key) return row.e2ee_key;
  const key = legacyRoomE2EEKey(row.name);
  db.prepare('UPDATE rooms SET e2ee_key = ? WHERE id = ?').run(key, roomId);
  return key;
}

/** Give the room a new key. Only safe while nobody is in it (or about to join). */
export function rotateRoomE2EEKey(roomId: number): void {
  db.prepare('UPDATE rooms SET e2ee_key = ? WHERE id = ?').run(newRoomE2EEKey(), roomId);
}

let roomService: RoomServiceClient | null = null;
function getRoomService(): RoomServiceClient {
  if (!roomService) {
    // RoomServiceClient needs the HTTP URL
    const httpUrl = (process.env.LIVEKIT_URL || 'ws://localhost:7881').replace(/^ws/, 'http');
    roomService = new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  }
  return roomService;
}

/** Kick a participant from a LiveKit room server-side */
export async function removeParticipant(roomName: string, identity: string): Promise<void> {
  try {
    await getRoomService().removeParticipant(roomName, identity);
  } catch (err) {
    console.warn(`Failed to remove participant ${identity} from ${roomName}:`, err);
  }
}

/** Whether LiveKit currently has anyone in the room (a new instance may have started). */
export async function roomHasParticipants(roomName: string): Promise<boolean> {
  const rooms = await getRoomService().listRooms([roomName]);
  return rooms.some((r) => r.numParticipants > 0);
}
