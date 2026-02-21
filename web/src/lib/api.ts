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
  mode?: 'normal' | 'whispers';
  is_jail?: number;
  created_by?: number | null;
  jail_source_room_id?: number | null;
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

// Votes
export interface Vote {
  id: number;
  sourceRoomId: number;
  targetUserId: number;
  targetUsername: string;
  targetDisplayName: string;
  initiatedBy: { id: number; username: string; displayName: string };
  durationSecs: number;
  eligibleCount: number;
  expiresAt: string;
}

export function startVote(targetUserId: number, durationSecs: number) {
  return request<{ vote: Vote }>('/votes', {
    method: 'POST',
    body: JSON.stringify({ targetUserId, durationSecs }),
  });
}

export function castBallot(voteId: number, voteYes: boolean) {
  return request<{ voteId: number; yesCount: number; noCount: number; eligibleCount: number }>(
    `/votes/${voteId}/ballot`,
    { method: 'POST', body: JSON.stringify({ voteYes }) },
  );
}

// Punishments
export interface Punishment {
  id: number;
  sourceRoomId: number;
  sourceRoomName: string;
  jailRoomId: number;
  jailRoomName: string;
  durationSecs: number;
  expiresAt: string;
}

export function getActivePunishments() {
  return request<{ punishments: Punishment[] }>('/punishments/active');
}

export function liftPunishment(punishmentId: number) {
  return request<{ lifted: boolean }>(`/punishments/${punishmentId}/lift`, { method: 'POST' });
}

export interface RoomPunishment {
  id: number;
  targetUserId: number;
  targetUsername: string;
  targetDisplayName: string;
  durationSecs: number;
  expiresAt: string;
}

export function getRoomPunishments(roomId: number) {
  return request<{ punishments: RoomPunishment[] }>(`/rooms/${roomId}/punishments`);
}

// Room mode
export function setRoomMode(roomId: number, mode: 'normal' | 'whispers') {
  return request<{ mode: string; chain?: ChainEntry[] }>(`/rooms/${roomId}/mode`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export interface ChainEntry {
  userId: number;
  username: string;
  displayName: string;
  position: number;
}

export function getRoomChain(roomId: number) {
  return request<{ chain: ChainEntry[] }>(`/rooms/${roomId}/chain`);
}

// Music Bot
export interface MusicQueueEntry {
  id: string;
  url: string;
  title: string;
  addedBy: string;
}

export interface MusicStation {
  id: string;
  name: string;
  genre: string;
}

export interface MusicStatus {
  mode: 'radio' | 'queue';
  paused: boolean;
  volume: number;
  nowPlaying: string | null;
  currentStation: MusicStation | null;
  queue: MusicQueueEntry[];
  stations: MusicStation[];
}

export function getMusicStatus() {
  return request<MusicStatus>('/music/status');
}

export function addToMusicQueue(url: string, title?: string) {
  return request<{ entry: MusicQueueEntry }>('/music/queue', {
    method: 'POST',
    body: JSON.stringify({ url, title }),
  });
}

export function removeFromMusicQueue(id: string) {
  return request<{ ok: boolean }>('/music/remove', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function skipMusicTrack() {
  return request<{ ok: boolean }>('/music/skip', { method: 'POST' });
}

export function setMusicStation(stationId: string) {
  return request<{ ok: boolean }>('/music/station', {
    method: 'POST',
    body: JSON.stringify({ stationId }),
  });
}

export function setMusicVolume(volume: number) {
  return request<{ ok: boolean }>('/music/volume', {
    method: 'POST',
    body: JSON.stringify({ volume }),
  });
}

export function toggleMusicPause() {
  return request<{ paused: boolean }>('/music/pause', { method: 'POST' });
}
