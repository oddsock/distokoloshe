import asyncio
import os
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
        # Check if URL is a playlist (contains list= param)
        if 'list=' in url:
            entries = await self._expand_playlist(url, added_by)
            if entries:
                self._queue.extend(entries)
                print(f"[player] Expanded playlist: {len(entries)} tracks")
                if self._mode == "radio":
                    await self._stop_ffmpeg()
                    self._stop_metadata_poller()
                    await self._play_next_from_queue()
                return entries[0]

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
        self._next_frame_time = None  # Reset wall-clock pacing

        # Resolve YouTube / yt-dlp-supported URLs to direct stream URLs
        stream_url = await self._resolve_url(url)
        if stream_url is None:
            print(f"[player] Failed to resolve URL: {url}")
            if self._mode == "queue":
                await self._play_next_from_queue()
            return

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", stream_url,
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
        import time as _time
        frame_duration = FRAME_MS / 1000  # 0.02s
        prefill_frames = 15  # Send first 15 frames (300ms) without pacing

        # Debug stats
        if not hasattr(self, '_dbg_frame_count'):
            self._dbg_frame_count = 0
            self._dbg_last_log = _time.monotonic()
            self._dbg_behind_count = 0

        # Initialise wall-clock target on first call per stream
        # Offset 300ms into the past to pre-fill the browser ring buffer
        if not hasattr(self, '_next_frame_time') or self._next_frame_time is None:
            self._next_frame_time = _time.monotonic() - (prefill_frames * frame_duration)
            self._prefill_sent = 0

        while len(self._pcm_buffer) >= BYTES_PER_FRAME:
            # Sleep until the absolute target time for this frame
            now = _time.monotonic()
            sleep_time = self._next_frame_time - now
            if sleep_time > 0.001:
                await asyncio.sleep(sleep_time)

            frame_bytes = bytes(self._pcm_buffer[:BYTES_PER_FRAME])
            del self._pcm_buffer[:BYTES_PER_FRAME]

            if self._volume < 100:
                frame_bytes = self._apply_volume(frame_bytes)

            if self._on_frame:
                await self._on_frame(frame_bytes)

            self._dbg_frame_count += 1
            self._next_frame_time += frame_duration

            # If we've fallen behind by >200ms, reset clock (prevents burst catch-up)
            if _time.monotonic() - self._next_frame_time > 0.2:
                self._dbg_behind_count += 1
                self._next_frame_time = _time.monotonic()

            # Log stats every 5s
            now = _time.monotonic()
            if now - self._dbg_last_log >= 5.0:
                buf_ms = len(self._pcm_buffer) * 1000 // (SAMPLE_RATE * CHANNELS * 2)
                print(f"[player] frames: {self._dbg_frame_count} | "
                      f"buf: {buf_ms}ms | "
                      f"behind-resets: {self._dbg_behind_count}")
                self._dbg_frame_count = 0
                self._dbg_behind_count = 0
                self._dbg_last_log = now

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

    def _needs_ytdlp(self, url: str) -> bool:
        """Check if a URL needs yt-dlp resolution."""
        parsed = urlparse(url)
        path_lower = parsed.path.lower()
        if any(path_lower.endswith(ext) for ext in (
            '.mp3', '.ogg', '.opus', '.aac', '.flac', '.wav', '.m4a',
        )):
            return False
        hostname = parsed.hostname or ''
        if any(d in hostname for d in ('somafm.com', 'icecast', 'shoutcast')):
            return False
        return True

    def _ytdlp_base_args(self) -> list[str]:
        """Common yt-dlp args with PO token server for YouTube bot bypass."""
        return [
            "yt-dlp",
            "-v",
            "--extractor-args",
            "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416",
        ]

    async def _resolve_url(self, url: str) -> Optional[str]:
        """Use yt-dlp to extract a direct audio stream URL.
        Returns the original URL if yt-dlp doesn't recognize it."""
        if not self._needs_ytdlp(url):
            return url

        try:
            base = self._ytdlp_base_args()
            proc = await asyncio.create_subprocess_exec(
                *base,
                "--no-playlist",
                "-f", "bestaudio/best",
                "--get-url",
                url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            if proc.returncode == 0:
                stream_url = stdout.decode().strip().split('\n')[0]
                if stream_url:
                    print(f"[player] Resolved URL via yt-dlp")
                    return stream_url
            err = stderr.decode().strip()
            if "Unsupported URL" in err:
                return url
            # Log first 3000 chars to see plugin loading, then last 1000 for error
            print(f"[player] yt-dlp verbose (start): {err[:3000]}")
            if len(err) > 3000:
                print(f"[player] yt-dlp verbose (end): {err[-1000:]}")
            return None
        except asyncio.TimeoutError:
            print("[player] yt-dlp timed out")
            return None
        except FileNotFoundError:
            return url

    async def _expand_playlist(self, url: str, added_by: str) -> list[dict]:
        """Use yt-dlp to expand a playlist URL into individual entries."""
        if not self._needs_ytdlp(url):
            return []

        try:
            base = self._ytdlp_base_args()
            proc = await asyncio.create_subprocess_exec(
                *base,
                "--flat-playlist",
                "--print", "%(url)s\t%(title)s",
                url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            if proc.returncode != 0:
                return []

            entries = []
            for line in stdout.decode().strip().split('\n'):
                if not line.strip():
                    continue
                parts = line.split('\t', 1)
                entry_url = parts[0].strip()
                entry_title = parts[1].strip() if len(parts) > 1 else ""
                if not entry_url:
                    continue
                # Ensure full YouTube URL if yt-dlp returns just an ID
                if not entry_url.startswith('http'):
                    entry_url = f"https://www.youtube.com/watch?v={entry_url}"
                self._id_counter += 1
                entries.append({
                    "id": str(self._id_counter),
                    "url": entry_url,
                    "title": entry_title or self._title_from_url(entry_url),
                    "addedBy": added_by,
                })
            return entries
        except (asyncio.TimeoutError, FileNotFoundError):
            return []

    def _title_from_url(self, url: str) -> str:
        try:
            pathname = urlparse(url).path
            filename = pathname.split("/")[-1] or url
            name = unquote(filename)
            return re.sub(r"\.[^.]+$", "", name)
        except Exception:
            return url
