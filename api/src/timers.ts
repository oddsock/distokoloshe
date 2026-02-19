import db from './db.js';
import { broadcast } from './events.js';

const voteTimers = new Map<number, NodeJS.Timeout>();
const punishmentTimers = new Map<number, NodeJS.Timeout>();

// ── Vote resolution (imported by votes route, called by timer or early trigger) ──

interface VoteRow {
  id: number;
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

/** Register a callback for when a vote passes (called from votes route init) */
export function setVotePassedHandler(handler: ResolveVoteCallback): void {
  onVotePassed = handler;
}

/** Resolve a vote — called by timer expiry or early resolution */
export function resolveVote(voteId: number): void {
  cancelVoteTimer(voteId);

  const vote = db.prepare('SELECT * FROM votes WHERE id = ? AND resolved = 0').get(voteId) as VoteRow | undefined;
  if (!vote) return;

  const passed = vote.yes_count > vote.eligible_count / 2;
  db.prepare('UPDATE votes SET resolved = 1, passed = ? WHERE id = ?').run(passed ? 1 : 0, voteId);

  const targetUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(vote.target_user_id) as
    { id: number; username: string; display_name: string } | undefined;

  broadcast('vote:resolved', {
    voteId: vote.id,
    sourceRoomId: vote.source_room_id,
    passed,
    yesCount: vote.yes_count,
    noCount: vote.no_count,
    eligibleCount: vote.eligible_count,
    targetUserId: vote.target_user_id,
    targetUsername: targetUser?.username,
    targetDisplayName: targetUser?.display_name,
  });

  if (passed && onVotePassed) {
    onVotePassed(vote).catch((err) => {
      console.error('Vote passed handler failed:', err);
    });
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

function expirePunishment(punishmentId: number): void {
  const punishment = db.prepare(
    'SELECT * FROM punishments WHERE id = ? AND active = 1',
  ).get(punishmentId) as PunishmentRow | undefined;
  if (!punishment) return;

  db.prepare('UPDATE punishments SET active = 0 WHERE id = ?').run(punishmentId);

  const sourceRoom = db.prepare('SELECT name FROM rooms WHERE id = ?').get(punishment.source_room_id) as
    { name: string } | undefined;

  broadcast('punishment:expired', {
    punishmentId: punishment.id,
    targetUserId: punishment.target_user_id,
    sourceRoomId: punishment.source_room_id,
    sourceRoomName: sourceRoom?.name ?? 'Unknown',
  });
}

// ── Restore timers on startup ──

export function restoreTimers(): void {
  const now = new Date().toISOString();

  // Restore active vote timers
  const activeVotes = db.prepare(
    "SELECT * FROM votes WHERE resolved = 0 AND expires_at > ?",
  ).all(now) as VoteRow[];
  for (const vote of activeVotes) {
    const remaining = new Date(vote.expires_at + 'Z').getTime() - Date.now();
    if (remaining > 0) {
      startVoteTimer(vote.id, remaining);
    } else {
      resolveVote(vote.id);
    }
  }

  // Restore active punishment timers
  const activePunishments = db.prepare(
    "SELECT * FROM punishments WHERE active = 1 AND expires_at > ?",
  ).all(now) as PunishmentRow[];
  for (const p of activePunishments) {
    const remaining = new Date(p.expires_at + 'Z').getTime() - Date.now();
    if (remaining > 0) {
      startPunishmentTimer(p.id, remaining);
    } else {
      expirePunishment(p.id);
    }
  }

  // Expire any that passed their deadline while server was down
  db.prepare(
    "UPDATE punishments SET active = 0 WHERE active = 1 AND expires_at <= ?",
  ).run(now);
  db.prepare(
    "UPDATE votes SET resolved = 1 WHERE resolved = 0 AND expires_at <= ?",
  ).run(now);

  const restoredVotes = activeVotes.filter(
    (v) => new Date(v.expires_at + 'Z').getTime() > Date.now(),
  ).length;
  const restoredPunishments = activePunishments.filter(
    (p) => new Date(p.expires_at + 'Z').getTime() > Date.now(),
  ).length;
  if (restoredVotes > 0 || restoredPunishments > 0) {
    console.log(`Restored ${restoredVotes} vote timer(s) and ${restoredPunishments} punishment timer(s)`);
  }
}
