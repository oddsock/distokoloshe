import asyncio
import hmac
import hashlib
import json
import os
import base64
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from aiohttp import web
from playwright.async_api import async_playwright, Browser, Page

BOT_IDENTITY = "__music-bot__"
BOT_NAME = "DJ Tokoloshe"
BRIDGE_PORT = 9222
BROWSER_DIR = Path(__file__).parent / "browser"


class MusicBot:
    def __init__(self):
        self._livekit_url = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7881")
        self._api_key = os.environ["LIVEKIT_API_KEY"]
        self._api_secret = os.environ["LIVEKIT_API_SECRET"]
        self._room_name = os.environ.get("MUSIC_ROOM_NAME", "Music")
        self._e2ee_secret = os.environ.get("E2EE_SECRET", "")
        self._browser: Optional[Browser] = None
        self._page: Optional[Page] = None
        self._pw = None
        self._ws_clients: list[web.WebSocketResponse] = []
        self._bridge_runner: Optional[web.AppRunner] = None
        self._connected = False

    async def start(self):
        await self._start_bridge()
        await self._connect_with_retry()

    async def handle_frame(self, pcm_bytes: bytes):
        if not self._connected or not self._ws_clients:
            return
        dead = []
        for ws in self._ws_clients:
            try:
                await ws.send_bytes(pcm_bytes)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._ws_clients.remove(ws)

    # ── Bridge Server (serves HTML + WebSocket) ──────────

    async def _start_bridge(self):
        app = web.Application()
        app.router.add_get("/pcm", self._ws_handler)
        app.router.add_static("/", BROWSER_DIR, show_index=True)

        self._bridge_runner = web.AppRunner(app)
        await self._bridge_runner.setup()
        site = web.TCPSite(self._bridge_runner, "127.0.0.1", BRIDGE_PORT)
        await site.start()
        print(f"[bot] Bridge server on http://127.0.0.1:{BRIDGE_PORT}")

    async def _ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self._ws_clients.append(ws)
        print("[bot] Browser connected to PCM bridge")
        try:
            async for msg in ws:
                pass
        finally:
            if ws in self._ws_clients:
                self._ws_clients.remove(ws)
            print("[bot] Browser disconnected from PCM bridge")
        return ws

    # ── Headless Browser ─────────────────────────────────

    async def _connect_with_retry(self):
        max_retries = 5
        for attempt in range(1, max_retries + 1):
            try:
                print(f"[bot] Launching headless browser (attempt {attempt}/{max_retries})...")
                await self._launch_browser()
                print("[bot] Headless browser connected to LiveKit!")
                self._connected = True
                return
            except Exception as e:
                print(f"[bot] Attempt {attempt} failed: {e}")
                await self._cleanup_browser()
                if attempt < max_retries:
                    delay = min(2 * attempt, 10)
                    print(f"[bot] Retrying in {delay}s...")
                    await asyncio.sleep(delay)

        print("[bot] All attempts failed. Retrying in 15s...")
        await asyncio.sleep(15)
        asyncio.create_task(self._connect_with_retry())

    async def _launch_browser(self):
        token = self._generate_token()
        e2ee_key = self._derive_e2ee_key() if self._e2ee_secret else ""

        page_url = (
            f"http://127.0.0.1:{BRIDGE_PORT}/index.html"
            f"?ws_url={quote(self._livekit_url)}"
            f"&token={quote(token)}"
            f"&e2ee_key={quote(e2ee_key)}"
            f"&bridge_port={BRIDGE_PORT}"
        )

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
                "--no-sandbox",
                "--disable-gpu",
                # Disable WebRTC audio processing that distorts music
                "--disable-features=WebRtcAGC2,AudioServiceAudioProcessing",
                "--disable-audio-output-resampler",
            ],
        )

        context = await self._browser.new_context(
            permissions=["microphone"],
        )
        self._page = await context.new_page()

        self._page.on("console", lambda msg: print(f"[browser] {msg.text}"))
        self._page.on("pageerror", lambda err: print(f"[browser-error] {err}"))

        await self._page.goto(page_url)

        # Wait for the bot to signal ready
        for _ in range(60):
            ready = await self._page.evaluate("() => window.__BOT_READY === true")
            if ready:
                return
            await asyncio.sleep(1)

        raise TimeoutError("Browser bot did not become ready within 60s")

    async def _cleanup_browser(self):
        self._connected = False
        if self._page:
            try:
                await self._page.close()
            except Exception:
                pass
            self._page = None
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._pw:
            try:
                await self._pw.stop()
            except Exception:
                pass
            self._pw = None

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

    # ── YouTube URL Extraction ──────────────────────────

    async def extract_youtube_audio_url(self, video_id: str) -> Optional[str]:
        """Use the headless browser to extract a YouTube audio stream URL.
        Navigates to YouTube, intercepts googlevideo.com audio requests."""
        if not self._browser:
            print("[bot] Browser not available for YouTube extraction")
            return None

        audio_url = None
        context = None

        try:
            context = await self._browser.new_context()
            page = await context.new_page()

            async def on_response(response):
                nonlocal audio_url
                if audio_url:
                    return
                url = response.url
                if "googlevideo.com" in url and ("mime=audio" in url or "mime%3Daudio" in url):
                    audio_url = url
                    print(f"[bot] Captured YouTube audio stream URL")

            page.on("response", on_response)

            yt_url = f"https://www.youtube.com/watch?v={video_id}"
            print(f"[bot] Extracting audio URL via browser: {yt_url}")
            await page.goto(yt_url, wait_until="load", timeout=30000)
            await asyncio.sleep(2)  # Let YouTube JS initialize

            title = await page.title()
            print(f"[bot] YouTube page title: {title}")

            # Try multiple methods to start playback
            started = await page.evaluate("""() => {
                // Method 1: Click the video element directly
                const video = document.querySelector('video');
                if (video) {
                    video.play().catch(() => {});
                    return 'video.play()';
                }
                // Method 2: Click the large play button
                const playBtn = document.querySelector('.ytp-large-play-button');
                if (playBtn) {
                    playBtn.click();
                    return 'play-button-click';
                }
                // Method 3: Click the video player area
                const player = document.querySelector('#movie_player');
                if (player) {
                    player.click();
                    return 'player-click';
                }
                return 'no-player-found';
            }""")
            print(f"[bot] Playback trigger: {started}")

            # Wait for audio stream to appear (up to 30s)
            for i in range(60):
                if audio_url:
                    break
                await asyncio.sleep(0.5)
                # Re-trigger play at 5s and 10s if still no audio
                if i in (10, 20):
                    await page.evaluate("() => { const v = document.querySelector('video'); if (v) v.play().catch(() => {}); }")

            if audio_url:
                print(f"[bot] Got YouTube audio URL ({len(audio_url)} chars)")
            else:
                # Save debug screenshot
                await page.screenshot(path="/tmp/youtube_debug.png")
                print("[bot] No audio stream captured (screenshot saved to /tmp/youtube_debug.png)")

        except Exception as e:
            print(f"[bot] YouTube extraction error: {e}")
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

        return audio_url

    def _derive_e2ee_key(self) -> str:
        secret = self._e2ee_secret or os.environ.get("JWT_SECRET", "")
        h = hmac.new(secret.encode(), self._room_name.encode(), hashlib.sha256)
        return base64.b64encode(h.digest()).decode()
