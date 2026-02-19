const TOKEN_KEY = 'distokoloshe_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(res.status, body.error || 'Request failed');
  }

  return res.json();
}

// Auth
export interface User {
  id: number;
  username: string;
  display_name: string;
  last_room_id: number | null;
}

interface AuthResponse {
  token: string;
  user: User;
}

export function register(username: string, display_name: string, password: string) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, display_name, password }),
  });
}

export function login(username: string, password: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getMe() {
  return request<{ user: User }>('/auth/me');
}

// Rooms
export interface Room {
  id: number;
  name: string;
  type: 'voice' | 'video';
  created_at: string;
}

export interface JoinRoomResponse {
  token: string;
  e2eeKey: string;
  room: Room;
  wsUrl: string;
}

export function listRooms() {
  return request<{ rooms: Room[] }>('/rooms');
}

export function createRoom(name: string, type: 'voice' | 'video' = 'voice') {
  return request<{ room: Room }>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, type }),
  });
}

export function joinRoom(roomId: number) {
  return request<JoinRoomResponse>(`/rooms/${roomId}/join`, { method: 'POST' });
}

export function deleteRoom(roomId: number) {
  return request<{ deleted: boolean }>(`/rooms/${roomId}`, { method: 'DELETE' });
}

// Users
export interface UserListItem {
  id: number;
  username: string;
  display_name: string;
  last_seen: string | null;
  is_online: boolean;
}

export function listUsers() {
  return request<{ users: UserListItem[] }>('/users');
}

// Room members (who is currently in which room)
export interface RoomMember {
  id: number;
  username: string;
  display_name: string;
}

export function listRoomMembers() {
  return request<{ members: Record<string, RoomMember[]> }>('/rooms/members');
}
