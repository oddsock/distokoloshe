import db from './db.js';
import { broadcast, broadcastToRoom } from './events.js';
import { removeFromChain } from './whispers.js';

/**
 * Announce that a user left a room, and drop them from its whisper chain if the
 * room is in whispers mode. Callers update room tracking (setUserRoom) themselves.
 */
export function broadcastRoomLeave(userId: number, roomId: number): void {
  const user = db.prepare(
    'SELECT id, username, display_name FROM users WHERE id = ?',
  ).get(userId) as { id: number; username: string; display_name: string } | undefined;
  if (!user) return;
  broadcast('user:room_leave', { user, roomId });

  const room = db.prepare('SELECT mode FROM rooms WHERE id = ?').get(roomId) as { mode: string } | undefined;
  if (room?.mode === 'whispers') {
    const chain = removeFromChain(roomId, userId);
    broadcastToRoom(roomId, 'whispers:chain_updated', { roomId, chain, reason: 'user_left' });
  }
}
