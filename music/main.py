import asyncio
import os
import sys
from aiohttp import web
from player import Player
from bot import MusicBot
from api import create_routes


async def main():
    for key in ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]:
        if not os.environ.get(key):
            print(f"Missing required env var: {key}")
            sys.exit(1)

    player = Player()
    bot = MusicBot()

    # Wire player frames to bot (async callback)
    player.set_frame_callback(bot.handle_frame)

    # Start player (radio by default)
    asyncio.create_task(player.start())

    # Connect bot to LiveKit (async, retries on failure)
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
