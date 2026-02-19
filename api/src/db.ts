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

// Seed a default "General" room if no rooms exist
const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get() as { count: number };
if (roomCount.count === 0) {
  db.prepare('INSERT INTO rooms (name, type) VALUES (?, ?)').run('General', 'voice');
}

export default db;
