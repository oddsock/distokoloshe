import { Response } from 'express';

export type EventType =
  | 'room:created'
  | 'room:deleted'
  | 'user:online'
  | 'user:offline'
  | 'user:registered'
  | 'user:room_join'
  | 'user:room_leave'
  | 'vote:started'
  | 'vote:ballot_cast'
  | 'vote:resolved'
  | 'punishment:started'
  | 'punishment:expired'
  | 'punishment:lifted'
  | 'whispers:activated'
  | 'whispers:deactivated'
  | 'whispers:chain_updated'
  | 'soundboard:created'
  | 'soundboard:deleted';

interface SSEClient {
  userId: number;
  res: Response;
  roomId: number | null;
}

const clients: SSEClient[] = [];

const MAX_CONNECTIONS_PER_USER = 3;
const MAX_CONNECTIONS_TOTAL = 500;

// Grace period: defer leave/offline broadcasts so brief SSE reconnects are invisible
const GRACE_PERIOD_MS = 15_000;

interface PendingDisconnect {
  timer: NodeJS.Timeout;
  roomId: number | null;
  userId: number;
}

const pendingDisconnects = new Map<number, PendingDisconnect>();

export function canAddClient(userId: number): { allowed: boolean; reason?: string } {
  if (clients.length >= MAX_CONNECTIONS_TOTAL) {
    return { allowed: false, reason: 'Server connection limit reached' };
  }
  const userConns = clients.filter((c) => c.userId === userId).length;
  if (userConns >= MAX_CONNECTIONS_PER_USER) {
    return { allowed: false, reason: 'Too many concurrent connections' };
  }
  return { allowed: true };
}

export function addClient(userId: number, res: Response): void {
  clients.push({ userId, res, roomId: null });
}

export function removeClient(res: Response): { userId: number; roomId: number | null } | null {
  const idx = clients.findIndex((c) => c.res === res);
  if (idx !== -1) {
    const removed = clients.splice(idx, 1)[0];
    return { userId: removed.userId, roomId: removed.roomId };
  }
  return null;
}

export function isUserOnline(userId: number): boolean {
  return clients.some((c) => c.userId === userId);
}

export function setUserRoom(userId: number, roomId: number | null): void {
  for (const client of clients) {
    if (client.userId === userId) {
      client.roomId = roomId;
    }
  }
}

export function getUserRoomId(userId: number): number | null {
  const client = clients.find((c) => c.userId === userId);
  return client?.roomId ?? null;
}

export function isUserInRoom(userId: number, roomId: number): boolean {
  return clients.some((c) => c.userId === userId && c.roomId === roomId);
}

export function getRoomMembers(): Record<number, number[]> {
  const members: Record<number, number[]> = {};
  for (const client of clients) {
    if (client.roomId !== null) {
      if (!members[client.roomId]) members[client.roomId] = [];
      if (!members[client.roomId].includes(client.userId)) {
        members[client.roomId].push(client.userId);
      }
    }
  }
  return members;
}

/**
 * Schedule a deferred disconnect. If the user reconnects within GRACE_PERIOD_MS,
 * cancelPendingDisconnect() restores their roomId on the new connection.
 * If the timer expires, onExpire runs the actual leave/offline broadcasts.
 */
export function scheduleDisconnect(
  userId: number,
  roomId: number | null,
  onExpire: () => void,
): void {
  // Cancel any existing pending disconnect for this user
  cancelPendingDisconnect(userId);

  const timer = setTimeout(() => {
    pendingDisconnects.delete(userId);
    onExpire();
  }, GRACE_PERIOD_MS);

  pendingDisconnects.set(userId, { timer, roomId, userId });
}

/**
 * Cancel a pending disconnect for a user (they reconnected in time).
 * Returns the preserved roomId so it can be transferred to the new connection.
 */
export function cancelPendingDisconnect(userId: number): { roomId: number | null } | null {
  const pending = pendingDisconnects.get(userId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingDisconnects.delete(userId);
    return { roomId: pending.roomId };
  }
  return null;
}

export function broadcast(event: EventType, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: Response[] = [];
  for (const client of clients) {
    try {
      if (client.res.writableEnded) {
        dead.push(client.res);
      } else {
        client.res.write(message);
      }
    } catch {
      dead.push(client.res);
    }
  }
  for (const res of dead) {
    removeClient(res);
  }
}

export function broadcastToRoom(roomId: number, event: EventType, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: Response[] = [];
  for (const client of clients) {
    if (client.roomId === roomId) {
      try {
        if (client.res.writableEnded) {
          dead.push(client.res);
        } else {
          client.res.write(message);
        }
      } catch {
        dead.push(client.res);
      }
    }
  }
  for (const res of dead) {
    removeClient(res);
  }
}
