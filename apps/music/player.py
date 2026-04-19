import asyncio
import signal
import re
import struct
import math
import subprocess
import time as _time
from urllib.parse import urlparse, unquote
from typing import Callable, Awaitable, Optional
from stations import STATIONS, DEFAULT_STATION_ID, get_station


def _detect_soxr() -> bool:
    """Check if FFmpeg was built with libsoxr support."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True, timeout=5,
        )
        return "enable-libsoxr" in result.stdout
    except Exception:
        return False


HAS_SOXR = _detect_soxr()
print(f"[player] Resampler: {'soxr (high quality)' if HAS_SOXR else 'swr (enhanced filter)'}")

SAMPLE_RATE = 48000
CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 960
BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2  # 3840 (int16 = 2 bytes/sample)

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
        self._paused = False
        self._mode = "radio"
        self._id_counter = 0
        self._on_frame: Optional[FrameCallback] = None
        self._on_state_change = None
        self._read_task: Optional[asyncio.Task] = None
        # External mode: PCM frames pushed in by the desktop client over WS.
        self._external_session: Optional[dict] = None
        self._external_queue: Optional[asyncio.Queue] = None
        self._external_task: Optional[asyncio.Task] = None
        self._external_eof = False

    def set_frame_callback(self, cb: FrameCallback):
        self._on_frame = cb

    def set_state_change_callback(self, cb):
        self._on_state_change = cb

    def _notify_state_change(self):
        if self._on_state_change:
            asyncio.create_task(self._on_state_change(self.get_state()))

    async def start(self):
        await self._play_radio()

    def get_state(self) -> dict:
        station = get_station(self._current_station_id)
        state = {
            "mode": self._mode,
            "paused": self._paused,
            "nowPlaying": self._now_playing,
            "currentStation": station,
            "queue": list(self._queue),
        }
        if self._mode == "external" and self._external_session:
            state["streamer"] = self._external_session.get("addedBy")
            state["externalSessionId"] = self._external_session.get("id")
        return state

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

    async def toggle_pause(self) -> bool:
        self._paused = not self._paused
        if self._ffmpeg and self._ffmpeg.returncode is None:
            try:
                sig = signal.SIGSTOP if self._paused else signal.SIGCONT
                self._ffmpeg.send_signal(sig)
            except ProcessLookupError:
                pass
        return self._paused

    # ── External (client-piped) source ───────────────────

    async def start_external(self, session: dict) -> bool:
        """Take over the audio source with PCM pushed from a remote client.

        Returns False if another external session is already active (single-streamer
        lock). On success the radio/queue is suspended and resumes via
        end_external() or any disconnect path.
        """
        if self._mode == "external" and self._external_session:
            return False
        await self._stop_ffmpeg()
        self._stop_metadata_poller()
        self._mode = "external"
        self._external_session = {
            "id": str(session.get("id") or session.get("sessionId") or ""),
            "title": session.get("title") or "External stream",
            "addedBy": session.get("addedBy") or "Unknown",
        }
        self._now_playing = self._external_session["title"]
        self._external_queue = asyncio.Queue(maxsize=150)  # ~3s of 20ms frames
        self._external_eof = False
        self._external_task = asyncio.create_task(
            self._external_read_loop(self._external_session["id"])
        )
        self._notify_state_change()
        return True

    async def feed_external(self, session_id: str, pcm: bytes) -> bool:
        if (
            self._mode != "external"
            or not self._external_session
            or self._external_session["id"] != session_id
            or self._external_queue is None
        ):
            return False
        # Block (await) when the queue is full instead of dropping frames.
        # ffmpeg decodes far faster than realtime; if we drop here the player
        # loop reads newer-than-expected frames every 20ms and the audio
        # fast-forwards / sounds robotic. Awaiting put() backpressures the
        # WS handler -> TCP -> server relay -> desktop uploader -> ffmpeg
        # stdout, naturally throttling the entire pipeline to realtime.
        await self._external_queue.put(pcm)
        return True

    async def end_external(self, session_id: Optional[str] = None) -> bool:
        """Tear down the active external session (if any) and resume radio.

        Idempotent: a stale session_id (e.g. from a disconnected client racing
        a fresh start) is a no-op so reconnects don't kill the new session.
        """
        if self._mode != "external" or not self._external_session:
            return False
        if session_id is not None and session_id != self._external_session["id"]:
            return False
        qsize_on_entry = self._external_queue.qsize() if self._external_queue is not None else -1
        print(
            f"[player] end_external entry: session={session_id} "
            f"active={self._external_session['id']} qsize={qsize_on_entry} "
            f"eof_already={self._external_eof}"
        )
        self._external_eof = True
        if self._external_queue is not None:
            # Push EOS sentinel via blocking put so the read loop sees it
            # *after* every queued frame finishes playing, not in the middle.
            await self._external_queue.put(b"")
        if self._external_task and not self._external_task.done():
            # Allow up to ~10s for the prebuffer (2s) + queue (3s) + a bit of
            # pacing slack to drain naturally. Without enough time here the
            # task gets cancelled and the user hears the song cut off near
            # the end (everything buffered after the WS upload finishes is
            # discarded). Stop is also called on user-press, so this only
            # delays a deliberate stop by a few seconds at most.
            try:
                await asyncio.wait_for(self._external_task, timeout=10)
                print("[player] end_external: read loop drained cleanly")
            except asyncio.TimeoutError:
                qsize_at_cancel = self._external_queue.qsize() if self._external_queue is not None else -1
                print(
                    f"[player] end_external: drain TIMEOUT after 10s — "
                    f"cancelling read loop (qsize={qsize_at_cancel})"
                )
                self._external_task.cancel()
                try:
                    await self._external_task
                except asyncio.CancelledError:
                    pass
        self._external_task = None
        self._external_queue = None
        self._external_session = None
        await self._play_radio()
        return True

    async def _external_read_loop(self, session_id: str):
        """Pace external PCM frames into the AudioSource at 20ms intervals.

        Mirrors _read_loop: pre-buffers ~2s, then maintains next_frame_time so
        small jitter on the WS upload averages out without speed-up bursts.
        """
        assert self._external_queue is not None
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
            while (
                self._mode == "external"
                and self._external_session
                and self._external_session["id"] == session_id
            ):
                if prebuffering:
                    try:
                        chunk = await asyncio.wait_for(
                            self._external_queue.get(), timeout=10
                        )
                    except asyncio.TimeoutError:
                        # Streamer never delivered enough audio — give up.
                        break_reason = "prebuffer-timeout-10s"
                        break
                    if chunk == b"":
                        break_reason = "eos-sentinel-during-prebuffer"
                        break  # EOS before prebuffer reached
                    buffered.append(chunk)
                    if len(buffered) >= prebuf_frames:
                        prebuffering = False
                        next_frame_time = _time.monotonic()
                        print(f"[player] External prebuffered {len(buffered)} frames")
                    continue

                # Get the next frame (from prebuffer if non-empty, else queue)
                if buffered:
                    frame = buffered.pop(0)
                else:
                    try:
                        frame = await asyncio.wait_for(
                            self._external_queue.get(), timeout=5
                        )
                    except asyncio.TimeoutError:
                        # Streamer stalled past tolerance — treat as EOS
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

                if self._on_frame:
                    await self._on_frame(frame)
                frames_played += 1

                # Every ~5s of wall time, print cadence + queue depth so we
                # can see starvation approaching before the stall timer fires.
                if now - stat_last_log >= 5.0:
                    elapsed = now - stat_last_log
                    fps = (frames_played - stat_last_frames) / elapsed if elapsed > 0 else 0
                    qsize = self._external_queue.qsize()
                    print(
                        f"[player] external frames: {frames_played} "
                        f"({fps:.1f}/s) qsize={qsize} prebuf={len(buffered)}"
                    )
                    stat_last_log = now
                    stat_last_frames = frames_played
            else:
                # While-loop condition became false — session was swapped out
                # under us by a newer start_external.
                if break_reason is None:
                    break_reason = "session-mismatch-or-mode-change"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            break_reason = f"exception: {e}"
            print(f"[player] external_read_loop error: {e}")
        finally:
            seconds_played = frames_played * frame_duration
            qsize_final = self._external_queue.qsize() if self._external_queue is not None else -1
            print(
                f"[player] External session {session_id} ended "
                f"reason={break_reason or 'unknown'} "
                f"frames_played={frames_played} seconds_played={seconds_played:.1f} "
                f"qsize_final={qsize_final}"
            )
            # If we're still the active session (e.g. loop exited due to stall
            # rather than explicit end_external), schedule a self-clean so
            # radio resumes. Use a task because this runs inside the task we
            # want to end_external() to await.
            if (
                self._mode == "external"
                and self._external_session
                and self._external_session["id"] == session_id
            ):
                asyncio.create_task(self._self_teardown(session_id))

    async def _self_teardown(self, session_id: str):
        # Break the self-await cycle: detach the task handle first so
        # end_external() doesn't wait on itself.
        self._external_task = None
        await self.end_external(session_id)

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
        self._notify_state_change()

    async def _play_next_from_queue(self):
        if not self._queue:
            await self._play_radio()
            return
        self._mode = "queue"
        entry = self._queue.pop(0)
        self._current_track = entry
        self._now_playing = entry["title"]
        await self._spawn_ffmpeg(entry["url"])
        self._notify_state_change()

    async def _spawn_ffmpeg(self, url: str):
        await self._stop_ffmpeg()
        gen = self._ffmpeg_generation

        # Resolve YouTube / yt-dlp-supported URLs to direct stream URLs
        stream_url = await self._resolve_url(url)
        if stream_url is None:
            print(f"[player] Failed to resolve URL: {url}")
            if self._mode == "queue":
                await self._play_next_from_queue()
            return

        # Loudness normalization (EBU R128) + high-quality resampling.
        # loudnorm tames hot radio streams to -14 LUFS / -1 dBTP, preventing
        # clipping artifacts through the Opus encode/decode cycle.
        loudnorm = "loudnorm=I=-14:TP=-1:LRA=11"

        if HAS_SOXR:
            resample = "aresample=resampler=soxr:precision=28:dither_method=none"
        else:
            resample = "aresample=resampler=swr:filter_size=128:phase_shift=10:cutoff=0.95:dither_method=none"

        af = f"{loudnorm},{resample}"

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", stream_url,
            "-af", af,
            "-f", "s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            "-loglevel", "error",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._ffmpeg = proc

        print(f"[player] Stream started: {stream_url[:120]}")

        # Single task: reads PCM and feeds it directly to the callback.
        # AudioSource.capture_frame() is self-pacing (blocks when buffer full).
        self._read_task = asyncio.create_task(self._read_loop(proc, gen))

    async def _read_loop(self, proc: asyncio.subprocess.Process, gen: int):
        """Reads PCM from FFmpeg, slices into frames, feeds directly to AudioSource."""
        buf = bytearray()
        dbg_frames = 0
        dbg_last_log = _time.monotonic()
        frame_duration = FRAME_MS / 1000.0  # 0.02s

        # Pre-buffer 2 seconds of PCM before feeding to absorb source hiccups
        prebuf_bytes = BYTES_PER_FRAME * (2000 // FRAME_MS)  # 2s worth
        prebuffering = True
        next_frame_time = 0.0  # set after prebuffering

        try:
            while gen == self._ffmpeg_generation:
                assert proc.stdout is not None
                chunk = await proc.stdout.read(BYTES_PER_FRAME)
                if not chunk:
                    break
                if gen != self._ffmpeg_generation:
                    return
                buf.extend(chunk)

                if prebuffering:
                    if len(buf) < prebuf_bytes:
                        continue
                    prebuffering = False
                    next_frame_time = _time.monotonic()
                    print(f"[player] Pre-buffered {len(buf) // BYTES_PER_FRAME} frames ({len(buf) / (SAMPLE_RATE * CHANNELS * 2):.1f}s)")

                # Slice into frames and send at steady 20ms intervals
                while len(buf) >= BYTES_PER_FRAME:
                    frame = bytes(buf[:BYTES_PER_FRAME])
                    del buf[:BYTES_PER_FRAME]

                    # Pace: sleep until this frame's scheduled time
                    now = _time.monotonic()
                    drift = next_frame_time - now
                    if drift > 0:
                        await asyncio.sleep(drift)
                    elif drift < -0.1:
                        # Fell behind by >100ms — reset clock to avoid burst catch-up
                        next_frame_time = _time.monotonic()
                    next_frame_time += frame_duration

                    if self._on_frame:
                        await self._on_frame(frame)

                    dbg_frames += 1

                # Log every 5s with PCM diagnostics
                now = _time.monotonic()
                if now - dbg_last_log >= 5.0:
                    # Compute RMS of last frame for diagnostics
                    rms_db = "?"
                    try:
                        samples = struct.unpack(f"<{len(frame)//2}h", frame)
                        rms = math.sqrt(sum(s * s for s in samples) / len(samples))
                        rms_db = f"{20 * math.log10(max(rms, 1) / 32768):.1f}"
                    except Exception:
                        pass
                    elapsed = now - dbg_last_log
                    fps = dbg_frames / elapsed if elapsed > 0 else 0
                    print(f"[player] frames: {dbg_frames} ({fps:.1f}/s) rms: {rms_db} dBFS")
                    dbg_frames = 0
                    dbg_last_log = now

            if gen != self._ffmpeg_generation:
                return

            returncode = await proc.wait()
            if returncode != 0:
                stderr = ""
                if proc.stderr:
                    stderr = (await proc.stderr.read()).decode(errors="replace").strip()
                print(f"[player] ffmpeg exited with code {returncode}: {stderr[-300:]}")

            if gen != self._ffmpeg_generation:
                return

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
        """Fetch ICY in-band metadata by connecting with Icy-MetaData: 1 header."""
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                headers = {"Icy-MetaData": "1", "User-Agent": "distokoloshe/1.0"}
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    metaint = int(resp.headers.get("icy-metaint", 0))
                    if not metaint:
                        return  # Server doesn't support ICY metadata

                    # Read past one metaint block to reach the metadata byte
                    data = b""
                    async for chunk in resp.content.iter_any():
                        data += chunk
                        if len(data) >= metaint + 1:
                            break

                    if len(data) < metaint + 1:
                        return

                    # The byte at metaint is the metadata length * 16
                    meta_len = data[metaint] * 16
                    if meta_len == 0:
                        return

                    # Read more if we don't have the full metadata block yet
                    while len(data) < metaint + 1 + meta_len:
                        chunk = await resp.content.read(meta_len)
                        if not chunk:
                            return
                        data += chunk

                    meta_str = data[metaint + 1: metaint + 1 + meta_len].decode("utf-8", errors="replace").rstrip("\x00")
                    # Parse StreamTitle='...'; format
                    match = re.search(r"StreamTitle='(.*?)'", meta_str)
                    if match:
                        title = match.group(1).strip()
                        if title and title != self._now_playing:
                            self._now_playing = title
                            self._notify_state_change()
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

    async def _resolve_url(self, url: str) -> Optional[str]:
        """Resolve a URL to a direct audio stream via yt-dlp."""
        if not self._needs_ytdlp(url):
            return url

        try:
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp",
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
            print(f"[player] yt-dlp failed: {err[-500:]}")
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
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp",
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
