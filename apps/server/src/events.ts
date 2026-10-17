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
  | 'soundboard:deleted'
  | 'soundboard:playing'
  | 'chat:message'
  | 'music:status';

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
// Fast disconnect: used when heartbeat is stale, meaning the user is truly gone
const FAST_DISCONNECT_MS = 2_000;
// A heartbeat within this window means the client was alive recently → likely an SSE reconnect
const HEARTBEAT_FRESH_MS = 10_000;

const lastHeartbeat = new Map<number, number>();

export function updateHeartbeat(userId: number): void {
  lastHeartbeat.set(userId, Date.now());
}

export function getHeartbeatAge(userId: number): number {
  const ts = lastHeartbeat.get(userId);
  return ts == null ? Infinity : Date.now() - ts;
}

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
  gracePeriod?: number,
): void {
  // Cancel any existing pending disconnect for this user
  cancelPendingDisconnect(userId);

  // Default: use full grace period if heartbeat is fresh (SSE reconnect), otherwise fast
  const delay = gracePeriod ?? (getHeartbeatAge(userId) < HEARTBEAT_FRESH_MS ? GRACE_PERIOD_MS : FAST_DISCONNECT_MS);

  const timer = setTimeout(() => {
    pendingDisconnects.delete(userId);
    onExpire();
  }, delay);

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

function sendWhere(filter: (client: SSEClient) => boolean, event: EventType, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: Response[] = [];
  for (const client of clients) {
    if (!filter(client)) continue;
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

export function broadcast(event: EventType, data: unknown): void {
  sendWhere(() => true, event, data);
}

export function broadcastToRoom(roomId: number, event: EventType, data: unknown): void {
  sendWhere((c) => c.roomId === roomId, event, data);
}

/** Send only to one user's connections — for payloads meant for them alone (e.g. room credentials). */
export function sendToUser(userId: number, event: EventType, data: unknown): void {
  sendWhere((c) => c.userId === userId, event, data);
}

export function broadcastExceptUser(userId: number, event: EventType, data: unknown): void {
  sendWhere((c) => c.userId !== userId, event, data);
}
