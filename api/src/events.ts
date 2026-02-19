import { Response } from 'express';

export type EventType =
  | 'room:created'
  | 'room:deleted'
  | 'user:online'
  | 'user:offline'
  | 'user:registered'
  | 'user:room_join'
  | 'user:room_leave';

interface SSEClient {
  userId: number;
  res: Response;
  roomId: number | null;
}

const clients: SSEClient[] = [];

const MAX_CONNECTIONS_PER_USER = 3;
const MAX_CONNECTIONS_TOTAL = 500;

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

export function getOnlineUserIds(): Set<number> {
  return new Set(clients.map((c) => c.userId));
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

export function broadcast(event: EventType, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.res.write(message);
  }
}
