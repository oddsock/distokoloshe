import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
  TrackPublishOptions,
  EncryptionType,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { createHmac } from 'crypto';
import type { Player } from './player.js';

const BOT_IDENTITY = '__music-bot__';
const BOT_NAME = 'DJ Tokoloshe';
const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 2;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960

export class MusicBot {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private player: Player;
  private livekitUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private roomName: string;
  private e2eeSecret: string;
  private connected = false;

  constructor(player: Player) {
    this.player = player;
    this.livekitUrl = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7881';
    this.apiKey = process.env.LIVEKIT_API_KEY!;
    this.apiSecret = process.env.LIVEKIT_API_SECRET!;
    this.roomName = process.env.MUSIC_ROOM_NAME || 'Music';
    this.e2eeSecret = process.env.E2EE_SECRET || '';
  }

  async start(): Promise<void> {
    // Wire player frames to LiveKit audio source
    this.player.setFrameCallback((pcm) => this.handleFrame(pcm));

    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[bot] Connecting to LiveKit (attempt ${attempt}/${maxRetries})...`);
        console.log(`[bot] URL: ${this.livekitUrl}`);
        console.log(`[bot] Room: ${this.roomName}`);
        console.log(`[bot] E2EE: ${this.e2eeSecret ? 'enabled' : 'disabled'}`);
        await this.connect();
        console.log('[bot] Connected successfully!');
        return;
      } catch (err) {
        console.error(`[bot] Connection attempt ${attempt} failed:`, err);
        if (attempt < maxRetries) {
          const delay = Math.min(2000 * attempt, 10000);
          console.log(`[bot] Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    console.error(`[bot] Failed to connect after ${maxRetries} attempts. Will keep retrying in background.`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connectWithRetry(), 15000);
  }

  private async connect(): Promise<void> {
    const token = await this.generateToken();

    // Build E2EE options if secret is configured
    let e2eeOpts: any = undefined;
    if (this.e2eeSecret) {
      const keyBase64 = this.deriveE2EEKey();
      console.log('[bot] E2EE key derived, length:', keyBase64.length);
      e2eeOpts = {
        keyProviderOptions: {
          sharedKey: Buffer.from(keyBase64, 'base64'),
          ratchetSalt: new Uint8Array(0),
          ratchetWindowSize: 0,
          failureTolerance: -1,
        },
        encryptionType: EncryptionType.GCM,
      };
    }

    this.room = new Room();

    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.warn(`[bot] Disconnected from LiveKit: ${reason}`);
      this.connected = false;
      this.audioSource = null;
      this.scheduleReconnect();
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      console.log('[bot] Reconnecting...');
    });

    this.room.on(RoomEvent.Reconnected, () => {
      console.log('[bot] Reconnected!');
    });

    // Connect
    console.log('[bot] Calling room.connect()...');
    await this.room.connect(this.livekitUrl, token, {
      autoSubscribe: false,
      dynacast: false,
      encryption: e2eeOpts,
    });
    console.log('[bot] room.connect() resolved');

    // Create and publish audio track
    if (!this.room.localParticipant) {
      throw new Error('localParticipant is undefined after connect');
    }

    this.audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('music', this.audioSource);
    console.log('[bot] Publishing audio track...');
    const pubOpts = new TrackPublishOptions();
    await this.room.localParticipant.publishTrack(track, pubOpts);
    console.log('[bot] Audio track published');

    this.connected = true;
  }

  private handleFrame(pcm: Int16Array): void {
    if (!this.connected || !this.audioSource) return;
    try {
      const frame = new AudioFrame(
        pcm,
        SAMPLE_RATE,
        NUM_CHANNELS,
        SAMPLES_PER_FRAME,
      );
      this.audioSource.captureFrame(frame);
    } catch {
      // Silently drop frame on error (e.g. during reconnect)
    }
  }

  private async generateToken(): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: BOT_IDENTITY,
      name: BOT_NAME,
      ttl: '24h',
    });

    at.addGrant({
      roomJoin: true,
      room: this.roomName,
      canPublish: true,
      canSubscribe: false,
    });

    return await at.toJwt();
  }

  private deriveE2EEKey(): string {
    const secret = this.e2eeSecret || process.env.JWT_SECRET || '';
    const hmac = createHmac('sha256', secret);
    hmac.update(this.roomName);
    return hmac.digest('base64');
  }
}
