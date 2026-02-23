const TOKEN_KEY = 'distokoloshe_token';
const BASE_URL_KEY = 'distokoloshe_server_url';

// Base URL for API requests. Empty = relative (web proxy), absolute = desktop.
let baseUrl = localStorage.getItem(BASE_URL_KEY) || '';

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '');
  if (baseUrl) {
    localStorage.setItem(BASE_URL_KEY, baseUrl);
  } else {
    localStorage.removeItem(BASE_URL_KEY);
  }
}

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

  const res = await fetch(`${baseUrl}/api${path}`, { ...options, headers });

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

// Soundboard
export interface SoundboardClip {
  id: number;
  name: string;
  mime_type: string;
  size: number;
  uploaded_by: number;
  uploaderName: string;
  created_at: string;
}

export function listSoundboardClips() {
  return request<{ clips: SoundboardClip[] }>('/soundboard');
}

export async function uploadSoundboardClip(name: string, file: File): Promise<{ clip: SoundboardClip }> {
  const token = getStoredToken();
  const form = new FormData();
  form.append('name', name);
  form.append('file', file);

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/api/soundboard`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiError(res.status, body.error || 'Upload failed');
  }

  return res.json();
}

export function deleteSoundboardClip(id: number) {
  return request<{ deleted: boolean }>(`/soundboard/${id}`, { method: 'DELETE' });
}

export async function fetchSoundboardAudio(id: number): Promise<ArrayBuffer> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/api/soundboard/${id}/audio`, { headers });

  if (!res.ok) {
    throw new ApiError(res.status, 'Failed to fetch audio');
  }

  return res.arrayBuffer();
}
