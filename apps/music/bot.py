import asyncio
import hmac
import hashlib
import json
import os
import base64
import time
from pathlib import Path
from urllib.parse import quote

from aiohttp import web
from playwright.async_api import async_playwright, Browser, Page

BOT_IDENTITY = "__music-bot__"
BOT_NAME = "DJ Tokoloshe"
BRIDGE_PORT = 9222
BROWSER_DIR = Path(__file__).parent / "browser"

# Injected via Playwright addInitScript — runs before ANY page JavaScript.
# Forces Opus stereo encoding via SDP monkey-patching.
SDP_STEREO_PATCH = """
(function() {
  function patchOpusStereo(sdp) {
    var rtpMatch = sdp.match(/a=rtpmap:(\\d+) opus\\/48000\\/2/);
    if (!rtpMatch) return sdp;
    var pt = rtpMatch[1];
    var fmtpRe = new RegExp('(a=fmtp:' + pt + ' [^\\\\r\\\\n]+)');
    return sdp.replace(fmtpRe, function(match) {
      var parts = match.split(' ');
      var prefix = parts[0];
      var paramStr = parts.slice(1).join(' ');
      var pmap = {};
      paramStr.split(';').forEach(function(p) {
        var eq = p.indexOf('=');
        if (eq > 0) {
          pmap[p.substring(0, eq).trim()] = p.substring(eq + 1).trim();
        } else if (p.trim()) {
          pmap[p.trim()] = '';
        }
      });
      pmap['stereo'] = '1';
      pmap['sprop-stereo'] = '1';
      pmap['maxaveragebitrate'] = '256000';
      pmap['cbr'] = '1';
      var newParams = Object.keys(pmap).map(function(k) {
        return pmap[k] ? k + '=' + pmap[k] : k;
      }).join(';');
      var result = prefix + ' ' + newParams;
      console.log('[bot-browser] SDP patched:', result);
      return result;
    });
  }

  var origCreateOffer = RTCPeerConnection.prototype.createOffer;
  RTCPeerConnection.prototype.createOffer = function() {
    var self = this, args = arguments;
    return origCreateOffer.apply(self, args).then(function(offer) {
      if (offer && offer.sdp) offer.sdp = patchOpusStereo(offer.sdp);
      return offer;
    });
  };

  var origCreateAnswer = RTCPeerConnection.prototype.createAnswer;
  RTCPeerConnection.prototype.createAnswer = function() {
    var self = this, args = arguments;
    return origCreateAnswer.apply(self, args).then(function(answer) {
      if (answer && answer.sdp) answer.sdp = patchOpusStereo(answer.sdp);
      return answer;
    });
  };

  var origSetLD = RTCPeerConnection.prototype.setLocalDescription;
  RTCPeerConnection.prototype.setLocalDescription = function(desc) {
    if (desc && desc.sdp) {
      var patched = {type: desc.type, sdp: patchOpusStereo(desc.sdp)};
      return origSetLD.call(this, patched);
    }
    if (!desc || !desc.type) {
      var self = this;
      var isAnswer = (self.signalingState === 'have-remote-offer' ||
                      self.signalingState === 'have-remote-pranswer');
      var createFn = isAnswer ? origCreateAnswer : origCreateOffer;
      return createFn.call(self).then(function(sdpObj) {
        console.log('[bot-browser] SDP intercepted (implicit), patching...');
        var patched = {type: sdpObj.type, sdp: patchOpusStereo(sdpObj.sdp)};
        return origSetLD.call(self, patched);
      });
    }
    return origSetLD.call(this, desc);
  };

  console.log('[bot-browser] SDP stereo patch installed via addInitScript');
})();
"""


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
                # Disable ALL WebRTC audio processing (AGC, AEC, NS destroy music)
                "--disable-features=WebRtcAGC1,WebRtcAGC2,AudioServiceAudioProcessing,WebRtcHideLocalIpsWithMdns",
                "--disable-audio-output-resampler",
                "--disable-rtc-smoothness-algorithm",
                "--force-fieldtrials="
                "WebRTC-Audio-ABWENoTWCC/Enabled/"
                "WebRTC-Audio-Red-For-Opus/Disabled/",
                # Disable echo cancellation, noise suppression, auto gain via WebRTC internals
                "--disable-webrtc-apm-agc",
                "--disable-webrtc-hw-encoding",
            ],
        )

        context = await self._browser.new_context(
            permissions=["microphone"],
        )
        self._page = await context.new_page()

        self._page.on("console", lambda msg: print(f"[browser] {msg.text}"))
        self._page.on("pageerror", lambda err: print(f"[browser-error] {err}"))

        # Inject SDP patch before any page JS runs.
        # Forces Opus stereo encoding (stereo=1, sprop-stereo=1, cbr, 256kbps).
        await self._page.add_init_script(SDP_STEREO_PATCH)

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

    def _derive_e2ee_key(self) -> str:
        secret = self._e2ee_secret or os.environ.get("JWT_SECRET", "")
        h = hmac.new(secret.encode(), self._room_name.encode(), hashlib.sha256)
        return base64.b64encode(h.digest()).decode()
