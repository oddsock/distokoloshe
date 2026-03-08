import asyncio
import hmac
import hashlib
import json
import os
import base64
import time
from typing import Optional

from livekit import rtc

BOT_IDENTITY = "__music-bot__"
BOT_NAME = "DJ Tokoloshe"

SAMPLE_RATE = 48000
NUM_CHANNELS = 2


class MusicBot:
    def __init__(self):
        self._livekit_url = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7881")
        self._api_key = os.environ["LIVEKIT_API_KEY"]
        self._api_secret = os.environ["LIVEKIT_API_SECRET"]
        self._room_name = os.environ.get("MUSIC_ROOM_NAME", "Music")
        self._e2ee_secret = os.environ.get("E2EE_SECRET", "")
        self._room: Optional[rtc.Room] = None
        self._audio_source: Optional[rtc.AudioSource] = None
        self._connected = False

    async def start(self):
        await self._connect_with_retry()

    async def handle_frame(self, pcm_bytes: bytes):
        """Receive a frame of s16le interleaved PCM and push it to LiveKit."""
        if not self._connected or not self._audio_source:
            return
        try:
            # pcm_bytes is s16le interleaved stereo, 20ms frames (960 samples/ch)
            samples_per_channel = len(pcm_bytes) // (NUM_CHANNELS * 2)  # 2 bytes per int16
            frame = rtc.AudioFrame(
                data=pcm_bytes,
                sample_rate=SAMPLE_RATE,
                num_channels=NUM_CHANNELS,
                samples_per_channel=samples_per_channel,
            )
            await self._audio_source.capture_frame(frame)
        except Exception as e:
            print(f"[bot] Frame capture error: {e}")

    # ── Connection ────────────────────────────────────────

    async def _connect_with_retry(self):
        max_retries = 5
        for attempt in range(1, max_retries + 1):
            try:
                print(f"[bot] Connecting to LiveKit (attempt {attempt}/{max_retries})...")
                await self._connect()
                print("[bot] Connected to LiveKit and publishing audio!")
                self._connected = True
                return
            except Exception as e:
                print(f"[bot] Attempt {attempt} failed: {e}")
                await self._cleanup()
                if attempt < max_retries:
                    delay = min(2 * attempt, 10)
                    print(f"[bot] Retrying in {delay}s...")
                    await asyncio.sleep(delay)

        print("[bot] All attempts failed. Retrying in 15s...")
        await asyncio.sleep(15)
        asyncio.create_task(self._connect_with_retry())

    async def _connect(self):
        token = self._generate_token()

        # Create audio source — feeds PCM directly to LiveKit's Opus encoder
        self._audio_source = rtc.AudioSource(SAMPLE_RATE, NUM_CHANNELS, queue_size_ms=200)

        # Build room options
        # single_peer_connection=True matches the browser client behavior and
        # may fix the Rust FFI not detecting the PC as connected.
        room_options = rtc.RoomOptions(single_peer_connection=True)
        if self._e2ee_secret:
            e2ee_key = self._derive_e2ee_key().encode()
            room_options.e2ee = rtc.E2EEOptions(
                key_provider_options=rtc.KeyProviderOptions(shared_key=e2ee_key),
            )
            print("[bot] E2EE configured")

        self._room = rtc.Room()

        @self._room.on("disconnected")
        def on_disconnected(reason):
            print(f"[bot] Disconnected: {reason}")
            self._connected = False
            asyncio.create_task(self._reconnect())

        @self._room.on("reconnecting")
        def on_reconnecting():
            print("[bot] Reconnecting...")

        @self._room.on("reconnected")
        def on_reconnected():
            print("[bot] Reconnected")
            self._connected = True

        # Connect to LiveKit room
        await self._room.connect(self._livekit_url, token, room_options)
        print(f"[bot] Connected to room: {self._room_name}")

        # Create and publish audio track with high-quality music encoding
        track = rtc.LocalAudioTrack.create_audio_track("music", self._audio_source)
        options = rtc.TrackPublishOptions()
        # SOURCE_SCREENSHARE_AUDIO tells the Opus encoder to use AUDIO mode
        # (music-optimized) instead of VOIP mode (speech-optimized with filtering)
        options.source = rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO
        options.dtx = False
        options.red = False
        options.audio_encoding.max_bitrate = 256_000
        await self._room.local_participant.publish_track(track, options)
        print("[bot] Audio track published")

    async def _reconnect(self):
        await asyncio.sleep(5)
        await self._cleanup()
        await self._connect_with_retry()

    async def _cleanup(self):
        self._connected = False
        if self._room:
            try:
                await self._room.disconnect()
            except Exception:
                pass
            self._room = None
        self._audio_source = None

    # ── Token & E2EE ─────────────────────────────────────

    def _generate_token(self) -> str:
        now = int(time.time())
        claims = {
            "iss": self._api_key,
            "sub": BOT_IDENTITY,
            "name": BOT_NAME,
            "iat": now,
            "nbf": now,
            "exp": now + 86400,
            "video": {
                "roomJoin": True,
                "room": self._room_name,
                "canPublish": True,
                "canSubscribe": False,
            },
        }
        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
        ).rstrip(b"=")
        payload = base64.urlsafe_b64encode(
            json.dumps(claims).encode()
        ).rstrip(b"=")
        signing_input = header + b"." + payload
        signature = base64.urlsafe_b64encode(
            hmac.new(self._api_secret.encode(), signing_input, hashlib.sha256).digest()
        ).rstrip(b"=")
        return (signing_input + b"." + signature).decode()

    def _derive_e2ee_key(self) -> str:
        secret = self._e2ee_secret or os.environ.get("JWT_SECRET", "")
        h = hmac.new(secret.encode(), self._room_name.encode(), hashlib.sha256)
        return base64.b64encode(h.digest()).decode()
