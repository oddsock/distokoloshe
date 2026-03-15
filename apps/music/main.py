import asyncio
import os
import sys
import aiohttp
from aiohttp import web
from player import Player
from bot import MusicBot
from api import create_routes


async def main():
    for key in ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]:
        if not os.environ.get(key):
            print(f"Missing required env var: {key}")
            sys.exit(1)

    api_url = os.environ.get("API_URL", "http://127.0.0.1:3000")
    api_key = os.environ.get("LIVEKIT_API_KEY", "")

    async def notify_status_change(state: dict):
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{api_url}/api/music/notify",
                    json={**state, "stations": []},  # omit stations list to keep payload small
                    headers={"X-Internal-Key": api_key},
                    timeout=aiohttp.ClientTimeout(total=5),
                )
        except Exception:
            pass  # API unreachable — not critical

    player = Player()
    bot = MusicBot()

    # Wire player frames to bot (async callback)
    player.set_frame_callback(bot.handle_frame)
    # Wire state changes to SSE broadcast via API
    player.set_state_change_callback(notify_status_change)

    # Start player (radio by default)
    asyncio.create_task(player.start())

    # Connect to LiveKit and publish audio track
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
