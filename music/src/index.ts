import express from 'express';
import { Player } from './player.js';
import { createMusicRouter } from './api.js';

const app = express();
app.use(express.json({ limit: '16kb' }));

const player = new Player();

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Mount music control API + audio stream
app.use('/', createMusicRouter(player));

// Start playback (radio by default)
player.start();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DJ Tokoloshe music bot listening on :${PORT}`);
});
