import express from 'express';
import { Player } from './player.js';
import { MusicBot } from './bot.js';
import { createMusicRouter } from './api.js';

// Validate required env vars
const required = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const app = express();
app.use(express.json({ limit: '16kb' }));

const player = new Player();
const bot = new MusicBot(player);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Mount music control API
app.use('/', createMusicRouter(player));

// Start playback (radio by default)
player.start();

// Connect bot to LiveKit (async, retries on failure)
bot.start().catch((err) => {
  console.error('[bot] Fatal error during start:', err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DJ Tokoloshe music bot listening on :${PORT}`);
});
