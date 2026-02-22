import asyncio
import signal
import struct
import re
from urllib.parse import urlparse, unquote
from typing import Callable, Awaitable, Optional
from stations import STATIONS, DEFAULT_STATION_ID, get_station

SAMPLE_RATE = 48000
CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 960
BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2  # 3840

FrameCallback = Callable[[bytes], Awaitable[None]]


class Player:
    def __init__(self):
        self._ffmpeg: Optional[asyncio.subprocess.Process] = None
        self._ffmpeg_generation = 0
        self._metadata_task: Optional[asyncio.Task] = None
        self._current_station_id = DEFAULT_STATION_ID
        self._queue: list[dict] = []
        self._current_track: Optional[dict] = None
        self._now_playing: Optional[str] = None
        self._volume = 80
        self._paused = False
        self._mode = "radio"
        self._id_counter = 0
        self._pcm_buffer = bytearray()
        self._on_frame: Optional[FrameCallback] = None
        self._read_task: Optional[asyncio.Task] = None

    def set_frame_callback(self, cb: FrameCallback):
        self._on_frame = cb

    async def start(self):
        await self._play_radio()

    def get_state(self) -> dict:
        station = get_station(self._current_station_id)
        return {
            "mode": self._mode,
            "paused": self._paused,
            "volume": self._volume,
            "nowPlaying": self._now_playing,
            "currentStation": station,
            "queue": list(self._queue),
        }

    def get_stations(self) -> list[dict]:
        return STATIONS

    # ── Controls ─────────────────────────────────────────

    async def enqueue(self, url: str, title: str, added_by: str) -> dict:
        self._id_counter += 1
        entry = {
            "id": str(self._id_counter),
            "url": url,
            "title": title or self._title_from_url(url),
            "addedBy": added_by,
        }
        self._queue.append(entry)
        if self._mode == "radio":
            await self._stop_ffmpeg()
            self._stop_metadata_poller()
            await self._play_next_from_queue()
        return entry

    def remove_from_queue(self, entry_id: str) -> bool:
        for i, e in enumerate(self._queue):
            if e["id"] == entry_id:
                self._queue.pop(i)
                return True
        return False

    async def skip(self):
        if self._mode == "queue":
            await self._stop_ffmpeg()
            await self._play_next_from_queue()

    async def set_station(self, station_id: str) -> bool:
        station = get_station(station_id)
        if not station:
            return False
        self._current_station_id = station_id
        if self._mode == "radio":
            await self._stop_ffmpeg()
            self._stop_metadata_poller()
            await self._play_radio()
        return True

    def set_volume(self, vol: int):
        self._volume = max(0, min(100, round(vol)))

    async def toggle_pause(self) -> bool:
        self._paused = not self._paused
        if self._ffmpeg and self._ffmpeg.returncode is None:
            try:
                sig = signal.SIGSTOP if self._paused else signal.SIGCONT
                self._ffmpeg.send_signal(sig)
            except ProcessLookupError:
                pass
        return self._paused

    # ── Playback ─────────────────────────────────────────

    async def _play_radio(self):
        self._mode = "radio"
        self._current_track = None
        station = get_station(self._current_station_id)
        if not station:
            return
        self._now_playing = station["name"]
        await self._spawn_ffmpeg(station["url"])
        self._start_metadata_poller(station["url"])

    async def _play_next_from_queue(self):
        if not self._queue:
            await self._play_radio()
            return
        self._mode = "queue"
        entry = self._queue.pop(0)
        self._current_track = entry
        self._now_playing = entry["title"]
        await self._spawn_ffmpeg(entry["url"])

    async def _spawn_ffmpeg(self, url: str):
        await self._stop_ffmpeg()
        gen = self._ffmpeg_generation
        self._pcm_buffer = bytearray()

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", url,
            "-f", "s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            "-fflags", "+nobuffer",
            "-loglevel", "error",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._ffmpeg = proc

        self._read_task = asyncio.create_task(self._read_loop(proc, gen))

    async def _read_loop(self, proc: asyncio.subprocess.Process, gen: int):
        try:
            while True:
                if gen != self._ffmpeg_generation:
                    return
                assert proc.stdout is not None
                chunk = await proc.stdout.read(BYTES_PER_FRAME * 4)
                if not chunk:
                    break
                if gen != self._ffmpeg_generation:
                    return
                self._pcm_buffer.extend(chunk)
                await self._drain_frames()

            if gen != self._ffmpeg_generation:
                return

            returncode = await proc.wait()
            print(f"ffmpeg exited with code {returncode}")

            if self._mode == "queue":
                await self._play_next_from_queue()
            else:
                await asyncio.sleep(3)
                if gen == self._ffmpeg_generation and self._mode == "radio":
                    await self._play_radio()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[player] read_loop error: {e}")

    async def _drain_frames(self):
        while len(self._pcm_buffer) >= BYTES_PER_FRAME:
            frame_bytes = bytes(self._pcm_buffer[:BYTES_PER_FRAME])
            del self._pcm_buffer[:BYTES_PER_FRAME]

            if self._volume < 100:
                frame_bytes = self._apply_volume(frame_bytes)

            if self._on_frame:
                await self._on_frame(frame_bytes)

    def _apply_volume(self, frame_bytes: bytes) -> bytes:
        gain = self._volume / 100.0
        samples = struct.unpack(f"<{SAMPLES_PER_FRAME * CHANNELS}h", frame_bytes)
        adjusted = [max(-32768, min(32767, round(s * gain))) for s in samples]
        return struct.pack(f"<{SAMPLES_PER_FRAME * CHANNELS}h", *adjusted)

    async def _stop_ffmpeg(self):
        self._ffmpeg_generation += 1
        if self._read_task and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
            self._read_task = None
        if self._ffmpeg and self._ffmpeg.returncode is None:
            try:
                self._ffmpeg.terminate()
                await asyncio.wait_for(self._ffmpeg.wait(), timeout=5)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self._ffmpeg.kill()
                except ProcessLookupError:
                    pass
        self._ffmpeg = None
        self._pcm_buffer = bytearray()

    # ── ICY Metadata ─────────────────────────────────────

    def _start_metadata_poller(self, url: str):
        self._stop_metadata_poller()
        self._metadata_task = asyncio.create_task(self._metadata_loop(url))

    def _stop_metadata_poller(self):
        if self._metadata_task and not self._metadata_task.done():
            self._metadata_task.cancel()
            self._metadata_task = None

    async def _metadata_loop(self, url: str):
        try:
            while True:
                await self._fetch_icy_metadata(url)
                await asyncio.sleep(15)
        except asyncio.CancelledError:
            pass

    async def _fetch_icy_metadata(self, url: str):
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format_tags=StreamTitle",
                "-of", "default=noprint_wrappers=1:nokey=1",
                url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
                title = stdout.decode().strip()
                if title:
                    self._now_playing = title
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        except Exception:
            pass

    def _title_from_url(self, url: str) -> str:
        try:
            pathname = urlparse(url).path
            filename = pathname.split("/")[-1] or url
            name = unquote(filename)
            return re.sub(r"\.[^.]+$", "", name)
        except Exception:
            return url
