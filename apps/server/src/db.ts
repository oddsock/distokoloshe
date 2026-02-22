import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.env.DATA_DIR || './data', 'distokoloshe.db');

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT CHECK(type IN ('voice', 'video')) DEFAULT 'voice',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    last_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    last_seen TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    input_device_id TEXT,
    output_device_id TEXT,
    input_gain REAL DEFAULT 1.0,
    noise_suppression INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS punishments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id INTEGER NOT NULL REFERENCES users(id),
    source_room_id INTEGER NOT NULL REFERENCES rooms(id),
    jail_room_id INTEGER NOT NULL REFERENCES rooms(id),
    duration_secs INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    lifted_by INTEGER REFERENCES users(id),
    lifted_at TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_room_id INTEGER NOT NULL REFERENCES rooms(id),
    target_user_id INTEGER NOT NULL REFERENCES users(id),
    initiated_by INTEGER NOT NULL REFERENCES users(id),
    duration_secs INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL,
    yes_count INTEGER NOT NULL DEFAULT 0,
    no_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vote_ballots (
    vote_id INTEGER NOT NULL REFERENCES votes(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote_yes INTEGER NOT NULL,
    PRIMARY KEY (vote_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS whisper_chains (
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
`);

// Add last_seen column if upgrading from older schema
try {
  db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT');
} catch {
  // Column already exists
}

// Add created_by column if upgrading from older schema
try {
  db.exec('ALTER TABLE rooms ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
} catch {
  // Column already exists
}

// Add room mode and jail columns
try { db.exec("ALTER TABLE rooms ADD COLUMN mode TEXT DEFAULT 'normal'"); } catch {}
try { db.exec('ALTER TABLE rooms ADD COLUMN is_jail INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE rooms ADD COLUMN jail_source_room_id INTEGER REFERENCES rooms(id)'); } catch {}

// Seed a default "General" room if no rooms exist
const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get() as { count: number };
if (roomCount.count === 0) {
  db.prepare('INSERT INTO rooms (name, type) VALUES (?, ?)').run('General', 'voice');
}

export default db;
