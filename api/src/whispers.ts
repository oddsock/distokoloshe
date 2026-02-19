import db from './db.js';

export interface ChainEntry {
  userId: number;
  username: string;
  displayName: string;
  position: number;
}

interface ChainRow {
  user_id: number;
  username: string;
  display_name: string;
  position: number;
}

export function getChain(roomId: number): ChainEntry[] {
  const rows = db.prepare(`
    SELECT wc.user_id, wc.position, u.username, u.display_name
    FROM whisper_chains wc
    JOIN users u ON u.id = wc.user_id
    WHERE wc.room_id = ?
    ORDER BY wc.position
  `).all(roomId) as ChainRow[];

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    position: r.position,
  }));
}

/** Fisher-Yates shuffle and store chain for given user IDs */
export function shuffleChain(roomId: number, userIds: number[]): ChainEntry[] {
  // Fisher-Yates shuffle
  const shuffled = [...userIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  clearChain(roomId);

  const insert = db.prepare(
    'INSERT INTO whisper_chains (room_id, user_id, position) VALUES (?, ?, ?)',
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < shuffled.length; i++) {
      insert.run(roomId, shuffled[i], i);
    }
  });
  tx();

  return getChain(roomId);
}

/** Append a user to the end of the chain */
export function addToChain(roomId: number, userId: number): ChainEntry[] {
  const maxRow = db.prepare(
    'SELECT MAX(position) as maxPos FROM whisper_chains WHERE room_id = ?',
  ).get(roomId) as { maxPos: number | null };

  const nextPos = (maxRow.maxPos ?? -1) + 1;
  db.prepare(
    'INSERT OR IGNORE INTO whisper_chains (room_id, user_id, position) VALUES (?, ?, ?)',
  ).run(roomId, userId, nextPos);

  return getChain(roomId);
}

/** Remove a user from the chain and re-number positions */
export function removeFromChain(roomId: number, userId: number): ChainEntry[] {
  db.prepare(
    'DELETE FROM whisper_chains WHERE room_id = ? AND user_id = ?',
  ).run(roomId, userId);

  // Re-number remaining positions
  const remaining = db.prepare(
    'SELECT user_id FROM whisper_chains WHERE room_id = ? ORDER BY position',
  ).all(roomId) as { user_id: number }[];

  const update = db.prepare(
    'UPDATE whisper_chains SET position = ? WHERE room_id = ? AND user_id = ?',
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < remaining.length; i++) {
      update.run(i, roomId, remaining[i].user_id);
    }
  });
  tx();

  return getChain(roomId);
}

export function clearChain(roomId: number): void {
  db.prepare('DELETE FROM whisper_chains WHERE room_id = ?').run(roomId);
}
