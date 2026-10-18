import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  broadcast, broadcastToRoom, broadcastExceptUser, sendToUser,
  getUserRoomId, getRoomMembers, setUserRoom,
} from '../events.js';
import { broadcastRoomLeave } from '../presence.js';
import { generateRoomToken, getRoomE2EEKey, newRoomE2EEKey, removeParticipant } from '../livekit.js';
import {
  startVoteTimer,
  resolveVote,
  setVotePassedHandler,
  startPunishmentTimer,
  type VoteRow,
} from '../timers.js';

const router = Router();

const VALID_DURATIONS = [60, 300, 900, 1800]; // 1m, 5m, 15m, 30m
const VOTE_WINDOW_SECS = 30;

interface RoomRow {
  id: number;
  name: string;
  type: string;
  created_by: number | null;
  is_jail: number;
  mode: string;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
}

interface PunishmentRow {
  id: number;
  target_user_id: number;
  source_room_id: number;
  duration_secs: number;
}

function hasOpenVote(roomId: number): boolean {
  return !!db.prepare('SELECT id FROM votes WHERE source_room_id = ? AND resolved = 0').get(roomId);
}

/** People in the room who can vote (everyone but the target), snapshotted at the start. */
function eligibleVoters(roomId: number, targetUserId: number): number {
  return (getRoomMembers()[roomId] || []).filter((id) => id !== targetUserId).length;
}

/**
 * Create a vote with the initiator's ballot counted as yes, start its 30 s window and
 * announce it to the room. A lift vote is also sent to the jailed person, who isn't there.
 */
function openVote(req: Request, res: Response, v: {
  kind: 'jail' | 'lift'; roomId: number; targetUserId: number; durationSecs: number;
  eligibleCount: number; punishmentId: number | null;
}): void {
  const callerId = req.user!.sub;
  const result = db.prepare(`
    INSERT INTO votes (kind, punishment_id, source_room_id, target_user_id, initiated_by, duration_secs, expires_at, eligible_count, yes_count)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), ?, 1)
  `).run(v.kind, v.punishmentId, v.roomId, v.targetUserId, callerId, v.durationSecs, `+${VOTE_WINDOW_SECS} seconds`, v.eligibleCount);

  const voteId = result.lastInsertRowid as number;
  db.prepare('INSERT INTO vote_ballots (vote_id, user_id, vote_yes) VALUES (?, ?, 1)').run(voteId, callerId);
  startVoteTimer(voteId, VOTE_WINDOW_SECS * 1000);

  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(v.targetUserId) as UserRow;
  const vote = db.prepare('SELECT * FROM votes WHERE id = ?').get(voteId) as VoteRow;

  const announced = {
    id: vote.id,
    kind: vote.kind,
    punishmentId: vote.punishment_id,
    sourceRoomId: vote.source_room_id,
    targetUserId: vote.target_user_id,
    targetUsername: targetUser.username,
    targetDisplayName: targetUser.display_name,
    initiatedBy: {
      id: callerId,
      username: req.user!.username,
      displayName: req.user!.display_name,
    },
    durationSecs: vote.duration_secs,
    eligibleCount: vote.eligible_count,
    expiresAt: vote.expires_at,
  };
  broadcastToRoom(vote.source_room_id, 'vote:started', { vote: announced });
  if (vote.kind === 'lift') sendToUser(vote.target_user_id, 'vote:started', { vote: announced });

  res.status(201).json({ vote: announced });
}

// ── POST /api/votes — Start a vote: jail someone in your room, or release ('lift') someone
// jailed from it. Anyone in the room can start either; the same majority rule applies.
router.post('/', requireAuth, (req: Request, res: Response) => {
  const { kind = 'jail' } = req.body;
  if (kind === 'lift') {
    startLiftVote(req, res);
    return;
  }
  if (kind !== 'jail') {
    res.status(400).json({ error: 'kind must be "jail" or "lift"' });
    return;
  }

  const { targetUserId, durationSecs } = req.body;
  const callerId = req.user!.sub;

  if (!targetUserId || !durationSecs) {
    res.status(400).json({ error: 'targetUserId and durationSecs are required' });
    return;
  }

  if (!VALID_DURATIONS.includes(durationSecs)) {
    res.status(400).json({ error: 'durationSecs must be 60, 300, 900, or 1800' });
    return;
  }

  if (targetUserId === callerId) {
    res.status(400).json({ error: 'Cannot vote against yourself' });
    return;
  }

  // Check caller is in a room
  const callerRoomId = getUserRoomId(callerId);
  if (callerRoomId === null) {
    res.status(400).json({ error: 'You must be in a room to start a vote' });
    return;
  }

  // Check source room is not a jail
  const sourceRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(callerRoomId) as RoomRow | undefined;
  if (!sourceRoom || sourceRoom.is_jail) {
    res.status(400).json({ error: 'Cannot start votes in jail rooms' });
    return;
  }

  // Check target is in the same room
  const targetRoomId = getUserRoomId(targetUserId);
  if (targetRoomId !== callerRoomId) {
    res.status(400).json({ error: 'Target must be in the same room' });
    return;
  }

  if (hasOpenVote(callerRoomId)) {
    res.status(409).json({ error: 'A vote is already in progress in this room' });
    return;
  }

  // Check target not already punished for this room
  const activePunishment = db.prepare(
    "SELECT id FROM punishments WHERE target_user_id = ? AND source_room_id = ? AND active = 1 AND expires_at > datetime('now')",
  ).get(targetUserId, callerRoomId);
  if (activePunishment) {
    res.status(409).json({ error: 'Target is already punished from this room' });
    return;
  }

  const eligibleCount = eligibleVoters(callerRoomId, targetUserId);
  if (eligibleCount < 2) {
    res.status(400).json({ error: 'Need at least 3 people in the room to start a vote' });
    return;
  }

  openVote(req, res, {
    kind: 'jail', roomId: callerRoomId, targetUserId, durationSecs, eligibleCount, punishmentId: null,
  });
});

function startLiftVote(req: Request, res: Response): void {
  const { punishmentId } = req.body;
  if (!Number.isInteger(punishmentId)) {
    res.status(400).json({ error: 'punishmentId is required' });
    return;
  }

  const punishment = db.prepare(
    "SELECT * FROM punishments WHERE id = ? AND active = 1 AND expires_at > datetime('now')",
  ).get(punishmentId) as PunishmentRow | undefined;
  if (!punishment) {
    res.status(404).json({ error: 'They are no longer in jail' });
    return;
  }

  // Only the room they were jailed from decides
  const callerRoomId = getUserRoomId(req.user!.sub);
  if (callerRoomId !== punishment.source_room_id) {
    res.status(403).json({ error: 'Only people in the room they were jailed from can vote to release them' });
    return;
  }

  if (hasOpenVote(callerRoomId)) {
    res.status(409).json({ error: 'A vote is already in progress in this room' });
    return;
  }

  // The jailed person isn't in the room, so this is everyone present
  const eligibleCount = eligibleVoters(callerRoomId, punishment.target_user_id);
  if (eligibleCount < 2) {
    res.status(400).json({ error: 'Need at least 2 people in the room to vote' });
    return;
  }

  openVote(req, res, {
    kind: 'lift',
    roomId: callerRoomId,
    targetUserId: punishment.target_user_id,
    durationSecs: punishment.duration_secs,
    eligibleCount,
    punishmentId: punishment.id,
  });
}

// ── POST /api/votes/:id/ballot — Cast a ballot ──
router.post('/:id/ballot', requireAuth, (req: Request, res: Response) => {
  const voteId = parseInt(req.params.id, 10);
  const { voteYes } = req.body;
  const callerId = req.user!.sub;

  if (isNaN(voteId)) {
    res.status(400).json({ error: 'Invalid vote ID' });
    return;
  }

  if (typeof voteYes !== 'boolean') {
    res.status(400).json({ error: 'voteYes must be a boolean' });
    return;
  }

  const vote = db.prepare('SELECT * FROM votes WHERE id = ? AND resolved = 0').get(voteId) as VoteRow | undefined;
  if (!vote) {
    res.status(404).json({ error: 'Vote not found or already resolved' });
    return;
  }

  if (callerId === vote.target_user_id) {
    res.status(403).json({ error: 'The vote target cannot vote' });
    return;
  }

  // Check caller is in the same room
  const callerRoomId = getUserRoomId(callerId);
  if (callerRoomId !== vote.source_room_id) {
    res.status(403).json({ error: 'You must be in the same room to vote' });
    return;
  }

  // Check not already voted
  const existing = db.prepare('SELECT 1 FROM vote_ballots WHERE vote_id = ? AND user_id = ?').get(voteId, callerId);
  if (existing) {
    res.status(409).json({ error: 'You have already voted' });
    return;
  }

  // Record ballot
  db.prepare('INSERT INTO vote_ballots (vote_id, user_id, vote_yes) VALUES (?, ?, ?)').run(voteId, callerId, voteYes ? 1 : 0);

  // Update tallies
  if (voteYes) {
    db.prepare('UPDATE votes SET yes_count = yes_count + 1 WHERE id = ?').run(voteId);
  } else {
    db.prepare('UPDATE votes SET no_count = no_count + 1 WHERE id = ?').run(voteId);
  }

  const updated = db.prepare('SELECT * FROM votes WHERE id = ?').get(voteId) as VoteRow;

  broadcastToRoom(updated.source_room_id, 'vote:ballot_cast', {
    voteId: updated.id,
    sourceRoomId: updated.source_room_id,
    yesCount: updated.yes_count,
    noCount: updated.no_count,
    eligibleCount: updated.eligible_count,
  });

  // Check for early resolution
  const totalVotes = updated.yes_count + updated.no_count;
  const majority = updated.eligible_count / 2;

  if (updated.yes_count > majority || updated.no_count > majority || totalVotes >= updated.eligible_count) {
    resolveVote(voteId);
  }

  res.json({
    voteId: updated.id,
    yesCount: updated.yes_count,
    noCount: updated.no_count,
    eligibleCount: updated.eligible_count,
  });
});

// ── Jail vote passed — create jail room and punish target ──
setVotePassedHandler(async (vote) => {
  const sourceRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(vote.source_room_id) as RoomRow;
  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(vote.target_user_id) as UserRow;

  // Find or create jail room
  const jailName = `Jail: ${sourceRoom.name}`;
  let jailRoom = db.prepare('SELECT * FROM rooms WHERE name = ? AND is_jail = 1').get(jailName) as RoomRow | undefined;
  if (!jailRoom) {
    db.prepare(
      'INSERT INTO rooms (name, type, is_jail, jail_source_room_id, created_by, e2ee_key) VALUES (?, ?, 1, ?, NULL, ?)',
    ).run(jailName, sourceRoom.type, sourceRoom.id, newRoomE2EEKey());
    jailRoom = db.prepare('SELECT * FROM rooms WHERE name = ? AND is_jail = 1').get(jailName) as RoomRow;
  }

  // Insert punishment
  const punishResult = db.prepare(`
    INSERT INTO punishments (target_user_id, source_room_id, jail_room_id, duration_secs, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))
  `).run(vote.target_user_id, vote.source_room_id, jailRoom.id, vote.duration_secs, `+${vote.duration_secs} seconds`);

  const punishmentId = punishResult.lastInsertRowid as number;
  const punishment = db.prepare('SELECT * FROM punishments WHERE id = ?').get(punishmentId) as {
    id: number; expires_at: string;
  };

  // Start punishment expiry timer
  startPunishmentTimer(punishmentId, vote.duration_secs * 1000);

  // Kick from LiveKit
  await removeParticipant(sourceRoom.name, targetUser.username);

  // Generate jail room token
  const token = await generateRoomToken(targetUser.username, targetUser.display_name, jailRoom.name, targetUser.id);
  const e2eeKey = getRoomE2EEKey(jailRoom.id);

  // Update room membership tracking
  setUserRoom(vote.target_user_id, jailRoom.id);
  broadcastRoomLeave(vote.target_user_id, vote.source_room_id);
  broadcast('user:room_join', { user: targetUser, roomId: jailRoom.id });

  const punishmentInfo = {
    id: punishmentId,
    targetUserId: vote.target_user_id,
    targetUsername: targetUser.username,
    targetDisplayName: targetUser.display_name,
    sourceRoomId: vote.source_room_id,
    sourceRoomName: sourceRoom.name,
    jailRoomId: jailRoom.id,
    jailRoomName: jailRoom.name,
    durationSecs: vote.duration_secs,
    expiresAt: punishment.expires_at,
  };

  // Everyone else sees the punishment; only the target receives the jail room
  // credentials (the token is a valid LiveKit login as them).
  broadcastExceptUser(vote.target_user_id, 'punishment:started', { punishment: punishmentInfo });
  sendToUser(vote.target_user_id, 'punishment:started', {
    punishment: punishmentInfo,
    jailConnection: {
      token,
      e2eeKey,
      room: { id: jailRoom.id, name: jailRoom.name, type: jailRoom.type },
      wsUrl: '/livekit/',
    },
  });
});

export default router;
