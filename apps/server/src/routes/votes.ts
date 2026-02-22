import { Router, Request, Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast, broadcastToRoom, getUserRoomId, getRoomMembers, setUserRoom } from '../events.js';
import { generateRoomToken, deriveRoomE2EEKey, removeParticipant } from '../livekit.js';
import {
  startVoteTimer,
  resolveVote,
  setVotePassedHandler,
  startPunishmentTimer,
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

interface VoteRow {
  id: number;
  source_room_id: number;
  target_user_id: number;
  initiated_by: number;
  duration_secs: number;
  started_at: string;
  expires_at: string;
  resolved: number;
  passed: number;
  eligible_count: number;
  yes_count: number;
  no_count: number;
}

// ── POST /api/votes — Start a vote ──
router.post('/', requireAuth, (req: Request, res: Response) => {
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

  // Check no active vote in this room
  const activeVote = db.prepare(
    'SELECT id FROM votes WHERE source_room_id = ? AND resolved = 0',
  ).get(callerRoomId);
  if (activeVote) {
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

  // Snapshot eligible voters (room members minus target)
  const roomMembers = getRoomMembers();
  const memberIds = roomMembers[callerRoomId] || [];
  const eligibleCount = memberIds.filter((id) => id !== targetUserId).length;

  if (eligibleCount < 2) {
    res.status(400).json({ error: 'Need at least 3 people in the room to start a vote' });
    return;
  }

  // Create the vote
  const result = db.prepare(`
    INSERT INTO votes (source_room_id, target_user_id, initiated_by, duration_secs, expires_at, eligible_count, yes_count)
    VALUES (?, ?, ?, ?, datetime('now', '+${VOTE_WINDOW_SECS} seconds'), ?, 1)
  `).run(callerRoomId, targetUserId, callerId, durationSecs, eligibleCount);

  const voteId = result.lastInsertRowid as number;

  // Auto-record initiator's ballot as yes
  db.prepare('INSERT INTO vote_ballots (vote_id, user_id, vote_yes) VALUES (?, ?, 1)').run(voteId, callerId);

  // Start 30s timer
  startVoteTimer(voteId, VOTE_WINDOW_SECS * 1000);

  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(targetUserId) as UserRow;
  const vote = db.prepare('SELECT * FROM votes WHERE id = ?').get(voteId) as VoteRow;

  broadcastToRoom(callerRoomId, 'vote:started', {
    vote: {
      id: vote.id,
      sourceRoomId: vote.source_room_id,
      targetUserId: vote.target_user_id,
      targetUsername: targetUser.username,
      targetDisplayName: targetUser.display_name,
      initiatedBy: {
        id: req.user!.sub,
        username: req.user!.username,
        displayName: req.user!.display_name,
      },
      durationSecs: vote.duration_secs,
      eligibleCount: vote.eligible_count,
      expiresAt: vote.expires_at,
    },
  });

  res.status(201).json({
    vote: {
      id: vote.id,
      sourceRoomId: vote.source_room_id,
      targetUserId: vote.target_user_id,
      durationSecs: vote.duration_secs,
      eligibleCount: vote.eligible_count,
      expiresAt: vote.expires_at,
    },
  });
});

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

  if (updated.yes_count > majority || updated.no_count >= majority || totalVotes >= updated.eligible_count) {
    resolveVote(voteId);
  }

  res.json({
    voteId: updated.id,
    yesCount: updated.yes_count,
    noCount: updated.no_count,
    eligibleCount: updated.eligible_count,
  });
});

// ── Vote passed handler — create jail room and punish target ──
setVotePassedHandler(async (vote) => {
  const sourceRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(vote.source_room_id) as RoomRow;
  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(vote.target_user_id) as UserRow;

  // Find or create jail room
  const jailName = `Jail: ${sourceRoom.name}`;
  let jailRoom = db.prepare('SELECT * FROM rooms WHERE name = ? AND is_jail = 1').get(jailName) as RoomRow | undefined;
  if (!jailRoom) {
    db.prepare(
      'INSERT INTO rooms (name, type, is_jail, jail_source_room_id, created_by) VALUES (?, ?, 1, ?, NULL)',
    ).run(jailName, sourceRoom.type, sourceRoom.id);
    jailRoom = db.prepare('SELECT * FROM rooms WHERE name = ? AND is_jail = 1').get(jailName) as RoomRow;
  }

  // Insert punishment
  const punishResult = db.prepare(`
    INSERT INTO punishments (target_user_id, source_room_id, jail_room_id, duration_secs, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+${vote.duration_secs} seconds'))
  `).run(vote.target_user_id, vote.source_room_id, jailRoom.id, vote.duration_secs);

  const punishmentId = punishResult.lastInsertRowid as number;
  const punishment = db.prepare('SELECT * FROM punishments WHERE id = ?').get(punishmentId) as {
    id: number; expires_at: string;
  };

  // Start punishment expiry timer
  startPunishmentTimer(punishmentId, vote.duration_secs * 1000);

  // Kick from LiveKit
  await removeParticipant(sourceRoom.name, targetUser.username);

  // Generate jail room token
  const token = await generateRoomToken(targetUser.username, targetUser.display_name, jailRoom.name);
  const e2eeKey = deriveRoomE2EEKey(jailRoom.name);

  // Update room membership tracking
  setUserRoom(vote.target_user_id, jailRoom.id);
  broadcast('user:room_leave', { user: targetUser, roomId: vote.source_room_id });
  broadcast('user:room_join', { user: targetUser, roomId: jailRoom.id });

  // Broadcast punishment started
  broadcast('punishment:started', {
    punishment: {
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
    },
    // Connection details for the punished user's client
    jailConnection: {
      token,
      e2eeKey,
      room: { id: jailRoom.id, name: jailRoom.name, type: jailRoom.type },
      wsUrl: '/livekit/',
    },
  });
});

export default router;
