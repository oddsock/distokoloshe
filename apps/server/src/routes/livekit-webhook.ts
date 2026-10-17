import express, { Router, Request, Response } from 'express';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import db from '../db.js';
import { removeParticipant, rotateRoomE2EEKey, roomHasParticipants } from '../livekit.js';
import { getRoomMembers } from '../events.js';

const router = Router();

const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
let announced = false;

/**
 * Kick a jailed user who reached their source room without going through /join —
 * e.g. by reconnecting with a LiveKit token issued before the vote (valid for 2h).
 */
async function enforcePunishment(roomName: string, identity: string): Promise<void> {
  // Bots and piped streams use non-user identities (__music-bot__, __pipe-…__)
  if (identity.startsWith('__')) return;
  const punished = db.prepare(`
    SELECT 1 FROM punishments p
    JOIN rooms r ON r.id = p.source_room_id
    JOIN users u ON u.id = p.target_user_id
    WHERE u.username = ? AND r.name = ? AND p.active = 1 AND p.expires_at > datetime('now')
  `).get(identity, roomName);
  if (!punished) return;
  console.log(`[livekit-webhook] removing jailed user ${identity} from ${roomName}`);
  await removeParticipant(roomName, identity);
}

/**
 * The room emptied out (LiveKit closes it after empty_timeout) — give it a fresh E2EE
 * key so former members can't decrypt future sessions. Skipped if someone has just
 * fetched the current key via /join, or a new LiveKit instance already has people in
 * it: they'd be left holding a key nobody else uses.
 */
async function rotateKeyIfEmpty(roomName: string): Promise<void> {
  const room = db.prepare('SELECT id FROM rooms WHERE name = ?').get(roomName) as { id: number } | undefined;
  if (!room) return;
  if ((getRoomMembers()[room.id] ?? []).length > 0) return;
  if (await roomHasParticipants(roomName)) return;
  rotateRoomE2EEKey(room.id);
  console.log(`[livekit-webhook] rotated E2EE key for ${roomName}`);
}

// POST /api/livekit/webhook — sent by LiveKit straight to 127.0.0.1:3000 (nginx
// refuses it from outside), signed with the API secret.
router.post(
  '/webhook',
  express.text({ type: 'application/webhook+json' }),
  async (req: Request, res: Response) => {
    let event: WebhookEvent;
    try {
      event = await receiver.receive(typeof req.body === 'string' ? req.body : '', req.get('Authorization'));
    } catch (err) {
      console.warn('[livekit-webhook] rejected:', (err as Error).message);
      res.status(401).end();
      return;
    }
    res.status(200).end();
    if (!announced) {
      announced = true;
      console.log('[livekit-webhook] receiving events from LiveKit');
    }

    try {
      if (event.event === 'participant_joined' && event.room && event.participant) {
        await enforcePunishment(event.room.name, event.participant.identity);
      } else if (event.event === 'room_finished' && event.room) {
        await rotateKeyIfEmpty(event.room.name);
      }
    } catch (err) {
      console.error(`[livekit-webhook] ${event.event} handler failed:`, err);
    }
  },
);

export default router;
