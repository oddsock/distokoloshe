import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import https from 'https';
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

// 20ms frame at 48kHz stereo = 960 samples × 2 channels × 2 bytes = 3840 bytes
export type FrameCallback = (pcm: Int16Array) => void;

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000; // 960
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2; // 3840

export class Player {
  private ffmpeg: ChildProcess | null = null;
  private ffmpegGeneration = 0;
  private metadataTimer: ReturnType<typeof setInterval> | null = null;
  private currentStationId: string = DEFAULT_STATION_ID;
  private queue: QueueEntry[] = [];
  private currentTrack: QueueEntry | null = null;
  private nowPlaying: string | null = null;
  private volume: number = 80;
  private paused: boolean = false;
  private mode: 'radio' | 'queue' = 'radio';
  private idCounter = 0;
  private pcmBuffer: Buffer = Buffer.alloc(0);
  private onFrame: FrameCallback | null = null;

  setFrameCallback(cb: FrameCallback): void {
    this.onFrame = cb;
  }

  start(): void {
    this.playRadio();
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
      this.ffmpeg?.kill('SIGSTOP');
    } else {
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

    const gen = ++this.ffmpegGeneration;
    this.pcmBuffer = Buffer.alloc(0);

    const proc = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', url,
      '-f', 's16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-fflags', '+nobuffer',
      '-loglevel', 'error',
      'pipe:1',
    ]);

    this.ffmpeg = proc;

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (gen !== this.ffmpegGeneration) return;
      this.pcmBuffer = Buffer.concat([this.pcmBuffer, chunk]);
      this.drainFrames();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`ffmpeg: ${msg}`);
    });

    proc.on('close', (code) => {
      // Ignore if this is a stale generation (we already started a new one)
      if (gen !== this.ffmpegGeneration) return;
      console.log(`ffmpeg exited with code ${code}`);
      if (this.mode === 'queue') {
        this.playNextFromQueue();
      } else {
        // Radio stream dropped — restart after delay
        setTimeout(() => {
          if (gen === this.ffmpegGeneration && this.mode === 'radio') {
            this.playRadio();
          }
        }, 3000);
      }
    });
  }

  private drainFrames(): void {
    while (this.pcmBuffer.length >= BYTES_PER_FRAME) {
      const frameBytes = this.pcmBuffer.subarray(0, BYTES_PER_FRAME);
      this.pcmBuffer = this.pcmBuffer.subarray(BYTES_PER_FRAME);

      // Convert to Int16Array and apply volume
      const pcm = new Int16Array(
        frameBytes.buffer,
        frameBytes.byteOffset,
        SAMPLES_PER_FRAME * CHANNELS,
      );

      this.applyVolume(pcm);

      if (this.onFrame) {
        this.onFrame(pcm);
      }
    }
  }

  private applyVolume(pcm: Int16Array): void {
    if (this.volume >= 100) return;
    const gain = this.volume / 100;
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain)));
    }
  }

  private stopFfmpeg(): void {
    this.ffmpegGeneration++;
    if (this.ffmpeg) {
      if (!this.ffmpeg.killed) {
        this.ffmpeg.kill('SIGTERM');
      }
      this.ffmpeg = null;
    }
    this.pcmBuffer = Buffer.alloc(0);
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

    req.on('error', () => {});
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
