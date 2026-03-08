import asyncio
import struct
from aiohttp import web
from player import Player, SAMPLE_RATE, CHANNELS
from stations import get_station


def create_routes(player: Player) -> web.RouteTableDef:
    routes = web.RouteTableDef()

    @routes.get("/status")
    async def status(request):
        state = player.get_state()
        return web.json_response({**state, "stations": player.get_stations()})

    @routes.get("/health")
    async def health(request):
        return web.json_response({"status": "ok"})

    @routes.post("/queue")
    async def queue(request):
        body = await request.json()
        url = body.get("url", "")
        if not url or not isinstance(url, str):
            return web.json_response({"error": "url is required"}, status=400)
        if not url.startswith(("http://", "https://")):
            return web.json_response({"error": "url must be a valid HTTP(S) URL"}, status=400)
        if len(url) > 2048:
            return web.json_response({"error": "url too long"}, status=400)
        state = player.get_state()
        if len(state["queue"]) >= 50:
            return web.json_response({"error": "Queue is full (max 50)"}, status=400)
        entry = await player.enqueue(url, body.get("title", ""), body.get("addedBy", "Unknown"))
        return web.json_response({"entry": entry})

    @routes.post("/remove")
    async def remove(request):
        body = await request.json()
        entry_id = body.get("id", "")
        if not entry_id:
            return web.json_response({"error": "id is required"}, status=400)
        removed = player.remove_from_queue(str(entry_id))
        return web.json_response({"ok": removed})

    @routes.post("/skip")
    async def skip(request):
        await player.skip()
        return web.json_response({"ok": True})

    @routes.post("/station")
    async def station(request):
        body = await request.json()
        station_id = body.get("stationId", "")
        if not station_id or not get_station(station_id):
            return web.json_response({"error": "Invalid stationId"}, status=400)
        await player.set_station(station_id)
        return web.json_response({"ok": True})

    @routes.post("/pause")
    async def pause(request):
        paused = await player.toggle_pause()
        return web.json_response({"paused": paused})

    @routes.get("/stream")
    async def stream(request):
        """Debug endpoint: raw PCM from FFmpeg as WAV stream (bypasses LiveKit/Opus)."""
        resp = web.StreamResponse()
        resp.content_type = "audio/wav"
        resp.headers["Cache-Control"] = "no-cache"

        # Write a WAV header with max size (streaming)
        bits = 16
        byte_rate = SAMPLE_RATE * CHANNELS * (bits // 8)
        block_align = CHANNELS * (bits // 8)
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF", 0xFFFFFFFF - 8, b"WAVE",
            b"fmt ", 16, 1, CHANNELS, SAMPLE_RATE,
            byte_rate, block_align, bits,
            b"data", 0xFFFFFFFF - 44,
        )

        await resp.prepare(request)
        await resp.write(header)

        q: asyncio.Queue = asyncio.Queue(maxsize=500)  # ~10s buffer
        player._stream_listeners.append(q)
        try:
            while True:
                frame = await q.get()
                await resp.write(frame)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            player._stream_listeners.remove(q)
        return resp

    return routes
