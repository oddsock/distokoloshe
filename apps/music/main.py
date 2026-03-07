import asyncio
import os
import sys
from aiohttp import web
from player import Player
from bot import MusicBot
from api import create_routes


async def check_ytdlp():
    """Log yt-dlp version and PO token server status on startup."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp", "--version",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        print(f"[startup] yt-dlp version: {stdout.decode().strip()}")

        # Check bgutil pip plugin
        proc = await asyncio.create_subprocess_exec(
            "pip", "show", "bgutil-ytdlp-pot-provider",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            version_line = [l for l in stdout.decode().split('\n') if l.startswith('Version:')]
            print(f"[startup] bgutil plugin: installed ({version_line[0] if version_line else 'unknown'})")
        else:
            print("[startup] bgutil plugin: NOT installed")

        # Check yt-dlp plugin detection
        proc = await asyncio.create_subprocess_exec(
            "python", "-c",
            "from yt_dlp.plugins import PACKAGE_NAME, directories; print('Plugin dirs:', directories()); "
            "import importlib, sys; "
            "[print(f'  found: {k}') for k in sys.modules if 'bgutil' in k.lower() or 'pot' in k.lower()]",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        print(f"[startup] plugin check: {stdout.decode().strip()}")
        if stderr.decode().strip():
            print(f"[startup] plugin check err: {stderr.decode().strip()[:300]}")

        # Check bgutil PO token server
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get("http://127.0.0.1:4416/", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    print(f"[startup] PO token server: reachable (status {resp.status})")
        except Exception as e:
            print(f"[startup] PO token server: NOT reachable ({e})")
    except Exception as e:
        print(f"[startup] diagnostic error: {e}")


async def main():
    for key in ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]:
        if not os.environ.get(key):
            print(f"Missing required env var: {key}")
            sys.exit(1)

    await check_ytdlp()

    # Start Tor SOCKS proxy for yt-dlp (bypass YouTube IP bans)
    tor_proc = await asyncio.create_subprocess_exec(
        "tor", "--SocksPort", "9050", "--Log", "notice stderr",
        stderr=asyncio.subprocess.PIPE,
    )
    # Wait for Tor to bootstrap (up to 30s)
    import time
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", 9050), timeout=2)
            writer.close()
            await writer.wait_closed()
            print("[startup] Tor SOCKS proxy ready on :9050")
            break
        except (ConnectionRefusedError, asyncio.TimeoutError, OSError):
            await asyncio.sleep(1)
    else:
        print("[startup] WARNING: Tor failed to start (yt-dlp will use direct connection)")

    player = Player()
    bot = MusicBot()

    # Wire player frames to bot (async callback) + bot ref for browser extraction
    player.set_frame_callback(bot.handle_frame)
    player.set_bot(bot)

    # Start player (radio by default)
    asyncio.create_task(player.start())

    # Launch headless browser + connect to LiveKit
    asyncio.create_task(bot.start())

    # Start HTTP API
    app = web.Application()
    app.add_routes(create_routes(player))

    runner = web.AppRunner(app)
    await runner.setup()

    port = int(os.environ.get("PORT", "3001"))
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"DJ Tokoloshe music bot listening on :{port}")

    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
