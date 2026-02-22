import asyncio
import hmac
import hashlib
import os
from datetime import timedelta
from livekit import rtc, api

BOT_IDENTITY = "__music-bot__"
BOT_NAME = "DJ Tokoloshe"
SAMPLE_RATE = 48000
NUM_CHANNELS = 2
FRAME_DURATION_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_DURATION_MS // 1000  # 960


class MusicBot:
    def __init__(self):
        self._room: rtc.Room | None = None
        self._audio_source: rtc.AudioSource | None = None
        self._livekit_url = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7881")
        self._api_key = os.environ["LIVEKIT_API_KEY"]
        self._api_secret = os.environ["LIVEKIT_API_SECRET"]
        self._room_name = os.environ.get("MUSIC_ROOM_NAME", "Music")
        self._e2ee_secret = os.environ.get("E2EE_SECRET", "")
        self._connected = False

    async def start(self):
        await self._connect_with_retry()

    async def handle_frame(self, pcm_bytes: bytes):
        if not self._connected or not self._audio_source:
            return
        try:
            frame = rtc.AudioFrame(
                data=pcm_bytes,
                sample_rate=SAMPLE_RATE,
                num_channels=NUM_CHANNELS,
                samples_per_channel=SAMPLES_PER_FRAME,
            )
            await self._audio_source.capture_frame(frame)
        except Exception:
            pass

    async def _connect_with_retry(self):
        max_retries = 5
        for attempt in range(1, max_retries + 1):
            try:
                print(f"[bot] Connecting to LiveKit (attempt {attempt}/{max_retries})...")
                print(f"[bot] URL: {self._livekit_url}")
                print(f"[bot] Room: {self._room_name}")
                print(f"[bot] E2EE: {'enabled' if self._e2ee_secret else 'disabled'}")
                await self._connect()
                print("[bot] Connected successfully!")
                return
            except Exception as e:
                print(f"[bot] Connection attempt {attempt} failed: {e}")
                if attempt < max_retries:
                    delay = min(2000 * attempt, 10000) / 1000
                    print(f"[bot] Retrying in {delay}s...")
                    await asyncio.sleep(delay)

        print(f"[bot] Failed to connect after {max_retries} attempts. Retrying in background.")
        asyncio.create_task(self._schedule_reconnect())

    async def _schedule_reconnect(self):
        await asyncio.sleep(15)
        await self._connect_with_retry()

    async def _connect(self):
        token = self._generate_token()

        # Build E2EE options
        e2ee_options = None
        if self._e2ee_secret:
            key_bytes = self._derive_e2ee_key()
            print(f"[bot] E2EE key derived, length: {len(key_bytes)}")
            e2ee_options = rtc.E2EEOptions(
                key_provider_options=rtc.KeyProviderOptions(
                    shared_key=key_bytes,
                    ratchet_salt=b"",
                    ratchet_window_size=0,
                    failure_tolerance=-1,
                ),
                encryption_type=rtc.EncryptionType.GCM,
            )

        self._room = rtc.Room()

        @self._room.on("disconnected")
        def on_disconnected(reason):
            print(f"[bot] Disconnected from LiveKit: {reason}")
            self._connected = False
            self._audio_source = None
            asyncio.create_task(self._schedule_reconnect())

        @self._room.on("reconnecting")
        def on_reconnecting():
            print("[bot] Reconnecting...")

        @self._room.on("reconnected")
        def on_reconnected():
            print("[bot] Reconnected!")

        print("[bot] Calling room.connect()...")
        await self._room.connect(
            self._livekit_url,
            token,
            options=rtc.RoomOptions(
                auto_subscribe=False,
                dynacast=False,
                e2ee=e2ee_options,
            ),
        )
        print("[bot] room.connect() resolved")

        # Create and publish audio track
        self._audio_source = rtc.AudioSource(SAMPLE_RATE, NUM_CHANNELS)
        track = rtc.LocalAudioTrack.create_audio_track("music", self._audio_source)
        print("[bot] Publishing audio track...")
        pub_options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self._room.local_participant.publish_track(track, pub_options)
        print("[bot] Audio track published")
        self._connected = True

    def _generate_token(self) -> str:
        token = (
            api.AccessToken(self._api_key, self._api_secret)
            .with_identity(BOT_IDENTITY)
            .with_name(BOT_NAME)
            .with_ttl(timedelta(hours=24))
            .with_grants(api.VideoGrants(
                room_join=True,
                room=self._room_name,
                can_publish=True,
                can_subscribe=False,
            ))
        )
        return token.to_jwt()

    def _derive_e2ee_key(self) -> bytes:
        secret = self._e2ee_secret or os.environ.get("JWT_SECRET", "")
        h = hmac.new(secret.encode(), self._room_name.encode(), hashlib.sha256)
        return h.digest()  # 32 bytes (SHA-256)
