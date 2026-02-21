import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import https from 'https';
import type { Response } from 'express';
import { STATIONS, DEFAULT_STATION_ID, type RadioStation } from './stations.js';

export interface QueueEntry {
  id: string;
  url: string;
  title: string;
  addedBy: string;
}

export interface PlayerState {
  mode: 'radio' | 'queue';
  paused: boolean;
  volume: number;
  nowPlaying: string | null;
  currentStation: RadioStation | null;
  queue: QueueEntry[];
}

export class Player {
  private ffmpeg: ChildProcess | null = null;
  private metadataTimer: ReturnType<typeof setInterval> | null = null;
  private currentStationId: string = DEFAULT_STATION_ID;
  private queue: QueueEntry[] = [];
  private currentTrack: QueueEntry | null = null;
  private nowPlaying: string | null = null;
  private volume: number = 80;
  private paused: boolean = false;
  private mode: 'radio' | 'queue' = 'radio';
  private idCounter = 0;
  private clients: Set<Response> = new Set();

  start(): void {
    this.playRadio();
  }

  // ── HTTP Stream ──────────────────────────────────────

  addStreamClient(res: Response): void {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  private broadcast(chunk: Buffer): void {
    for (const client of this.clients) {
      if (!client.writableEnded) {
        client.write(chunk);
      }
    }
  }

  // ── State ────────────────────────────────────────────

  getState(): PlayerState {
    const station = STATIONS.find((s) => s.id === this.currentStationId) ?? null;
    return {
      mode: this.mode,
      paused: this.paused,
      volume: this.volume,
      nowPlaying: this.nowPlaying,
      currentStation: station,
      queue: [...this.queue],
    };
  }

  getStations(): RadioStation[] {
    return STATIONS;
  }

  // ── Controls ─────────────────────────────────────────

  enqueue(url: string, title: string, addedBy: string): QueueEntry {
    const entry: QueueEntry = {
      id: String(++this.idCounter),
      url,
      title: title || this.titleFromUrl(url),
      addedBy,
    };
    this.queue.push(entry);

    // If currently on radio, switch to queue mode
    if (this.mode === 'radio') {
      this.stopFfmpeg();
      this.stopMetadataPoller();
      this.playNextFromQueue();
    }
    return entry;
  }

  removeFromQueue(entryId: string): boolean {
    const idx = this.queue.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  skip(): void {
    if (this.mode === 'queue') {
      this.stopFfmpeg();
      this.playNextFromQueue();
    }
  }

  setStation(stationId: string): boolean {
    const station = STATIONS.find((s) => s.id === stationId);
    if (!station) return false;
    this.currentStationId = stationId;
    if (this.mode === 'radio') {
      this.stopFfmpeg();
      this.stopMetadataPoller();
      this.playRadio();
    }
    return true;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(vol)));
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    if (this.paused) {
      // Pause ffmpeg by sending SIGSTOP
      this.ffmpeg?.kill('SIGSTOP');
    } else {
      // Resume ffmpeg by sending SIGCONT
      this.ffmpeg?.kill('SIGCONT');
    }
    return this.paused;
  }

  // ── Playback ─────────────────────────────────────────

  private playRadio(): void {
    this.mode = 'radio';
    this.currentTrack = null;
    const station = STATIONS.find((s) => s.id === this.currentStationId);
    if (!station) return;
    this.nowPlaying = station.name;
    this.spawnFfmpeg(station.url);
    this.startMetadataPoller(station.url);
  }

  private playNextFromQueue(): void {
    if (this.queue.length === 0) {
      this.playRadio();
      return;
    }
    this.mode = 'queue';
    const entry = this.queue.shift()!;
    this.currentTrack = entry;
    this.nowPlaying = entry.title;
    this.spawnFfmpeg(entry.url);
  }

  private spawnFfmpeg(url: string): void {
    this.stopFfmpeg();

    this.ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', url,
      '-f', 'mp3',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-fflags', '+nobuffer',
      '-loglevel', 'error',
      'pipe:1',
    ]);

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.broadcast(chunk);
    });

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`ffmpeg: ${msg}`);
    });

    this.ffmpeg.on('close', (code) => {
      if (this.ffmpeg?.killed) return; // intentional stop
      console.log(`ffmpeg exited with code ${code}`);
      if (this.mode === 'queue') {
        this.playNextFromQueue();
      } else {
        // Radio stream dropped — restart after short delay
        setTimeout(() => {
          if (this.mode === 'radio') this.playRadio();
        }, 2000);
      }
    });
  }

  private stopFfmpeg(): void {
    if (this.ffmpeg) {
      this.ffmpeg.killed || this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
    }
  }

  // ── ICY Metadata ─────────────────────────────────────

  private startMetadataPoller(url: string): void {
    this.stopMetadataPoller();
    this.fetchIcyMetadata(url);
    this.metadataTimer = setInterval(() => this.fetchIcyMetadata(url), 15000);
  }

  private stopMetadataPoller(): void {
    if (this.metadataTimer) {
      clearInterval(this.metadataTimer);
      this.metadataTimer = null;
    }
  }

  private fetchIcyMetadata(url: string): void {
    const requester = url.startsWith('https') ? https : http;
    const req = requester.get(url, { headers: { 'Icy-MetaData': '1' } }, (res) => {
      const metaInt = parseInt(res.headers['icy-metaint'] as string, 10);
      if (!metaInt || isNaN(metaInt)) {
        req.destroy();
        return;
      }

      let audioBytes = 0;
      let waitingForMeta = false;
      let metaLength = 0;
      let metaBuffer = Buffer.alloc(0);

      res.on('data', (chunk: Buffer) => {
        let offset = 0;
        while (offset < chunk.length) {
          if (waitingForMeta) {
            if (metaLength === 0) {
              metaLength = chunk[offset] * 16;
              offset++;
              if (metaLength === 0) {
                waitingForMeta = false;
                audioBytes = 0;
                continue;
              }
              metaBuffer = Buffer.alloc(0);
            }
            const remaining = metaLength - metaBuffer.length;
            const available = Math.min(remaining, chunk.length - offset);
            metaBuffer = Buffer.concat([metaBuffer, chunk.subarray(offset, offset + available)]);
            offset += available;
            if (metaBuffer.length >= metaLength) {
              const metaStr = metaBuffer.toString('utf-8').replace(/\0+$/, '');
              const match = metaStr.match(/StreamTitle='(.+?)'/);
              if (match && match[1]) {
                this.nowPlaying = match[1];
              }
              req.destroy();
              return;
            }
          } else {
            const audioRemaining = metaInt - audioBytes;
            const skip = Math.min(audioRemaining, chunk.length - offset);
            audioBytes += skip;
            offset += skip;
            if (audioBytes >= metaInt) {
              waitingForMeta = true;
              metaLength = 0;
            }
          }
        }
      });

      setTimeout(() => req.destroy(), 10000);
    });

    req.on('error', () => {}); // Silently ignore metadata fetch errors
  }

  private titleFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() || url;
      return decodeURIComponent(filename).replace(/\.[^.]+$/, '');
    } catch {
      return url;
    }
  }
}
