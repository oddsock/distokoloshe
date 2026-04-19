"""Per-room ephemeral pipe bots.

Separate from the long-running MusicBot in bot.py. Each EphemeralSession owns
its own LiveKit room connection + AudioSource, takes PCM pushed from the API
relay, plays it into a single room, then disconnects and is dropped when the
user stops or the track ends. Memory is reclaimed by Python GC once no one
holds a reference — no process-level cleanup needed.

Mirrors the framing/pacing contract from player.py (s16le, 48 kHz stereo,
20 ms frames, 2 s prebuffer, 150-frame queue, 5 s stall → EOS treated as
soft-end) and the AudioSource FFI setup from bot.py (echo/noise/AGC off).
"""

import asyncio
import time as _time
from typing import Dict, Optional

from livekit import rtc
from livekit.rtc._ffi_client import FfiHandle, FfiClient
from livekit.rtc._proto import audio_frame_pb2 as proto_audio
from livekit.rtc._proto import ffi_pb2 as proto_ffi


SAMPLE_RATE = 48000
NUM_CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 960
BYTES_PER_FRAME = SAMPLES_PER_FRAME * NUM_CHANNELS * 2  # 3840
QUEUE_MAX_FRAMES = 150  # ~3 s of PCM


class EphemeralSession:
    def __init__(
        self,
        session_id: str,
        livekit_url: str,
        room_name: str,
        lk_token: str,
        e2ee_key: Optional[bytes],
        identity: str,
        display_name: str,
    ):
        self.session_id = session_id
        self._livekit_url = livekit_url
        self._room_name = room_name
        self._lk_token = lk_token
        self._e2ee_key = e2ee_key
        self._identity = identity
        self._display_name = display_name

        self._room: Optional[rtc.Room] = None
        self._audio_source: Optional[rtc.AudioSource] = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=QUEUE_MAX_FRAMES)
        self._task: Optional[asyncio.Task] = None
        self._eof = False
        self._connected = False
        self._closed = False

    async def start(self) -> None:
        """Connect to LiveKit + publish AudioSource track. Raises on failure."""
        # Build AudioSource via raw FFI so we can disable echo/noise/AGC, the
        # voice DSP that mangles music. Same shape as bot.py:_connect.
        req = proto_ffi.FfiRequest()
        req.new_audio_source.type = proto_audio.AudioSourceType.AUDIO_SOURCE_NATIVE
        req.new_audio_source.sample_rate = SAMPLE_RATE
        req.new_audio_source.num_channels = NUM_CHANNELS
        req.new_audio_source.queue_size_ms = 300
        req.new_audio_source.options.echo_cancellation = False
        req.new_audio_source.options.noise_suppression = False
        req.new_audio_source.options.auto_gain_control = False
        resp = FfiClient.instance.request(req)
        source = rtc.AudioSource.__new__(rtc.AudioSource)
        source._sample_rate = SAMPLE_RATE
        source._num_channels = NUM_CHANNELS
        source._loop = asyncio.get_event_loop()
        source._info = resp.new_audio_source.source
        source._ffi_handle = FfiHandle(resp.new_audio_source.source.handle.id)
        source._last_capture = 0.0
        source._q_size = 0.0
        source._join_handle = None
        source._join_fut = None
        self._audio_source = source

        room_options = rtc.RoomOptions(single_peer_connection=True)
        if self._e2ee_key:
            room_options.e2ee = rtc.E2EEOptions(
                key_provider_options=rtc.KeyProviderOptions(shared_key=self._e2ee_key),
            )

        self._room = rtc.Room()
        await self._room.connect(self._livekit_url, self._lk_token, room_options)
        self._connected = True

        track = rtc.LocalAudioTrack.create_audio_track("music", self._audio_source)
        options = rtc.TrackPublishOptions()
        options.source = rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO
        options.dtx = False
        options.red = False
        options.audio_encoding.max_bitrate = 510_000
        await self._room.local_participant.publish_track(track, options)

        self._task = asyncio.create_task(self._read_loop())
        print(
            f"[ephemeral] session={self.session_id} connected room={self._room_name} "
            f"identity={self._identity} name={self._display_name!r}"
        )

    async def feed(self, pcm: bytes) -> None:
        """Backpressured PCM push. Blocks when the queue is full."""
        if self._closed:
            return
        await self._queue.put(pcm)

    async def end(self) -> None:
        """Graceful end: push EOS sentinel, let the tail drain, disconnect."""
        if self._closed:
            return
        self._eof = True
        try:
            await self._queue.put(b"")
        except Exception:
            pass
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
        await self._teardown()

    async def force_close(self) -> None:
        """Abortive close (no drain) — called from the pool on unexpected error."""
        if self._closed:
            return
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await self._teardown()

    async def _teardown(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._room:
            try:
                await self._room.disconnect()
            except Exception:
                pass
            self._room = None
        self._audio_source = None
        self._task = None

    async def _read_loop(self) -> None:
        """Pace queued PCM frames into the AudioSource at 20 ms intervals."""
        assert self._audio_source is not None
        frame_duration = FRAME_MS / 1000.0
        prebuf_frames = 2000 // FRAME_MS
        buffered: list[bytes] = []
        prebuffering = True
        next_frame_time = 0.0
        frames_played = 0
        stat_last_log = _time.monotonic()
        stat_last_frames = 0
        break_reason: Optional[str] = None
        try:
            while not self._closed:
                if prebuffering:
                    try:
                        chunk = await asyncio.wait_for(self._queue.get(), timeout=10)
                    except asyncio.TimeoutError:
                        break_reason = "prebuffer-timeout-10s"
                        break
                    if chunk == b"":
                        break_reason = "eos-sentinel-during-prebuffer"
                        break
                    buffered.append(chunk)
                    if len(buffered) >= prebuf_frames:
                        prebuffering = False
                        next_frame_time = _time.monotonic()
                        print(
                            f"[ephemeral] session={self.session_id} "
                            f"prebuffered {len(buffered)} frames"
                        )
                    continue

                if buffered:
                    frame = buffered.pop(0)
                else:
                    try:
                        frame = await asyncio.wait_for(self._queue.get(), timeout=5)
                    except asyncio.TimeoutError:
                        break_reason = "stall-timeout-5s"
                        break
                if frame == b"":
                    break_reason = "eos-sentinel"
                    break

                now = _time.monotonic()
                drift = next_frame_time - now
                if drift > 0:
                    await asyncio.sleep(drift)
                elif drift < -0.1:
                    next_frame_time = _time.monotonic()
                next_frame_time += frame_duration

                try:
                    audio_frame = rtc.AudioFrame(
                        data=frame,
                        sample_rate=SAMPLE_RATE,
                        num_channels=NUM_CHANNELS,
                        samples_per_channel=SAMPLES_PER_FRAME,
                    )
                    await self._audio_source.capture_frame(audio_frame)
                except Exception as e:
                    break_reason = f"capture-error: {e}"
                    break
                frames_played += 1

                if now - stat_last_log >= 5.0:
                    elapsed = now - stat_last_log
                    fps = (frames_played - stat_last_frames) / elapsed if elapsed > 0 else 0
                    qsize = self._queue.qsize()
                    print(
                        f"[ephemeral] session={self.session_id} frames={frames_played} "
                        f"({fps:.1f}/s) qsize={qsize} prebuf={len(buffered)}"
                    )
                    stat_last_log = now
                    stat_last_frames = frames_played
        except asyncio.CancelledError:
            raise
        except Exception as e:
            break_reason = f"exception: {e}"
            print(f"[ephemeral] session={self.session_id} loop error: {e}")
        finally:
            seconds_played = frames_played * frame_duration
            print(
                f"[ephemeral] session={self.session_id} ended "
                f"reason={break_reason or 'unknown'} "
                f"frames_played={frames_played} seconds_played={seconds_played:.1f}"
            )


class EphemeralPool:
    def __init__(self):
        self._sessions: Dict[str, EphemeralSession] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        session_id: str,
        livekit_url: str,
        room_name: str,
        lk_token: str,
        e2ee_key: Optional[bytes],
        identity: str,
        display_name: str,
    ) -> EphemeralSession:
        async with self._lock:
            if session_id in self._sessions:
                raise RuntimeError(f"session {session_id} already exists")
            session = EphemeralSession(
                session_id=session_id,
                livekit_url=livekit_url,
                room_name=room_name,
                lk_token=lk_token,
                e2ee_key=e2ee_key,
                identity=identity,
                display_name=display_name,
            )
            try:
                await session.start()
            except Exception:
                await session.force_close()
                raise
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str) -> Optional[EphemeralSession]:
        return self._sessions.get(session_id)

    async def end(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        try:
            await session.end()
        except Exception as e:
            print(f"[ephemeral] session={session_id} end failed: {e}")
            try:
                await session.force_close()
            except Exception:
                pass
        return True

    def active_count(self) -> int:
        return len(self._sessions)
