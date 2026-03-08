from aiohttp import web
from player import Player
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

    return routes
