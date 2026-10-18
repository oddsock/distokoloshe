import db from './db.js';
import { broadcast, broadcastToRoom, sendToUser } from './events.js';

const voteTimers = new Map<number, NodeJS.Timeout>();
const punishmentTimers = new Map<number, NodeJS.Timeout>();

// ── Vote resolution (imported by votes route, called by timer or early trigger) ──

export interface VoteRow {
  id: number;
  kind: 'jail' | 'lift';
  /** Lift votes: the punishment they would end */
  punishment_id: number | null;
  source_room_id: number;
  target_user_id: number;
  initiated_by: number;
  duration_secs: number;
  expires_at: string;
  resolved: number;
  passed: number;
  eligible_count: number;
  yes_count: number;
  no_count: number;
}

export type ResolveVoteCallback = (vote: VoteRow) => Promise<void>;

let onVotePassed: ResolveVoteCallback | null = null;

/** Register a callback for when a jail vote passes (called from votes route init) */
export function setVotePassedHandler(handler: ResolveVoteCallback): void {
  onVotePassed = handler;
}

/** Tell the room how a vote ended — and, for a lift vote, the jailed person too (they're not in the room). */
function announceResult(vote: VoteRow, passed: boolean, voided = false): void {
  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(vote.target_user_id) as
    { id: number; username: string; display_name: string } | undefined;

  const payload = {
    voteId: vote.id,
    kind: vote.kind,
    sourceRoomId: vote.source_room_id,
    passed,
    voided,
    yesCount: vote.yes_count,
    noCount: vote.no_count,
    eligibleCount: vote.eligible_count,
    targetUserId: vote.target_user_id,
    targetUsername: targetUser?.username,
    targetDisplayName: targetUser?.display_name,
  };
  broadcastToRoom(vote.source_room_id, 'vote:resolved', payload);
  if (vote.kind === 'lift') sendToUser(vote.target_user_id, 'vote:resolved', payload);
}

/** Resolve a vote — called by timer expiry or early resolution */
export function resolveVote(voteId: number): void {
  cancelVoteTimer(voteId);

  try {
    const vote = db.prepare('SELECT * FROM votes WHERE id = ? AND resolved = 0').get(voteId) as VoteRow | undefined;
    if (!vote) return;

    const passed = vote.yes_count > vote.eligible_count / 2;
    db.prepare('UPDATE votes SET resolved = 1, passed = ? WHERE id = ?').run(passed ? 1 : 0, voteId);
    announceResult(vote, passed);

    if (!passed) return;
    if (vote.kind === 'lift') {
      if (vote.punishment_id !== null) liftPunishment(vote.punishment_id);
    } else if (onVotePassed) {
      onVotePassed(vote).catch((err) => {
        console.error('Vote passed handler failed:', err);
      });
    }
  } catch (err) {
    console.error(`Failed to resolve vote ${voteId}:`, err);
  }
}

// ── Vote timers ──

export function startVoteTimer(voteId: number, delayMs: number): void {
  cancelVoteTimer(voteId);
  const timer = setTimeout(() => {
    voteTimers.delete(voteId);
    resolveVote(voteId);
  }, delayMs);
  voteTimers.set(voteId, timer);
}

export function cancelVoteTimer(voteId: number): void {
  const timer = voteTimers.get(voteId);
  if (timer) {
    clearTimeout(timer);
    voteTimers.delete(voteId);
  }
}

// ── Punishment timers ──

interface PunishmentRow {
  id: number;
  target_user_id: number;
  source_room_id: number;
  jail_room_id: number;
  expires_at: string;
  active: number;
}

export function startPunishmentTimer(punishmentId: number, delayMs: number): void {
  cancelPunishmentTimer(punishmentId);
  const timer = setTimeout(() => {
    punishmentTimers.delete(punishmentId);
    expirePunishment(punishmentId);
  }, delayMs);
  punishmentTimers.set(punishmentId, timer);
}

export function cancelPunishmentTimer(punishmentId: number): void {
  const timer = punishmentTimers.get(punishmentId);
  if (timer) {
    clearTimeout(timer);
    punishmentTimers.delete(punishmentId);
  }
}

function sourceRoomName(roomId: number): string {
  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId) as { name: string } | undefined;
  return room?.name ?? 'Unknown';
}

function expirePunishment(punishmentId: number): void {
  const punishment = db.prepare(
    'SELECT * FROM punishments WHERE id = ? AND active = 1',
  ).get(punishmentId) as PunishmentRow | undefined;
  if (!punishment) return;

  db.prepare('UPDATE punishments SET active = 0 WHERE id = ?').run(punishmentId);

  // A lift vote still running for this sentence has nothing left to decide
  const openLiftVotes = db.prepare('SELECT * FROM votes WHERE punishment_id = ? AND resolved = 0').all(punishmentId) as VoteRow[];
  for (const vote of openLiftVotes) {
    cancelVoteTimer(vote.id);
    db.prepare('UPDATE votes SET resolved = 1 WHERE id = ?').run(vote.id);
    announceResult(vote, false, true);
  }

  broadcast('punishment:expired', {
    punishmentId: punishment.id,
    targetUserId: punishment.target_user_id,
    sourceRoomId: punishment.source_room_id,
    sourceRoomName: sourceRoomName(punishment.source_room_id),
  });
}

/** End a punishment early because a lift vote passed. The target's client rejoins on the event. */
function liftPunishment(punishmentId: number): void {
  const punishment = db.prepare(
    'SELECT * FROM punishments WHERE id = ? AND active = 1',
  ).get(punishmentId) as PunishmentRow | undefined;
  if (!punishment) return;

  db.prepare("UPDATE punishments SET active = 0, lifted_at = datetime('now') WHERE id = ?").run(punishmentId);
  cancelPunishmentTimer(punishmentId);

  broadcast('punishment:lifted', {
    punishmentId: punishment.id,
    targetUserId: punishment.target_user_id,
    sourceRoomId: punishment.source_room_id,
    sourceRoomName: sourceRoomName(punishment.source_room_id),
  });
}

// ── Restore timers on startup ──

/** Parse SQLite datetime('now') text ("YYYY-MM-DD HH:MM:SS", UTC) to epoch ms. */
function sqliteUtcToMs(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

export function restoreTimers(): void {
  const now = Date.now();
  let restoredVotes = 0;
  let restoredPunishments = 0;

  // Votes still open: re-arm the timer, or void the vote if its window closed while
  // the server was down (a vote that reached a majority would already be resolved).
  const openVotes = db.prepare('SELECT * FROM votes WHERE resolved = 0').all() as VoteRow[];
  for (const vote of openVotes) {
    const remaining = sqliteUtcToMs(vote.expires_at) - now;
    if (remaining > 0) {
      startVoteTimer(vote.id, remaining);
      restoredVotes++;
    } else {
      db.prepare('UPDATE votes SET resolved = 1 WHERE id = ?').run(vote.id);
    }
  }

  // Active punishments: re-arm the timer, or expire now (with broadcast) if overdue.
  const activePunishments = db.prepare('SELECT * FROM punishments WHERE active = 1').all() as PunishmentRow[];
  for (const p of activePunishments) {
    const remaining = sqliteUtcToMs(p.expires_at) - now;
    if (remaining > 0) {
      startPunishmentTimer(p.id, remaining);
      restoredPunishments++;
    } else {
      expirePunishment(p.id);
    }
  }

  if (restoredVotes > 0 || restoredPunishments > 0) {
    console.log(`Restored ${restoredVotes} vote timer(s) and ${restoredPunishments} punishment timer(s)`);
  }
}
