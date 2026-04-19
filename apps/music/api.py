import asyncio
import json
import os
import uuid

from aiohttp import web, WSMsgType

from player import Player, BYTES_PER_FRAME
from stations import get_station
from ephemeral import EphemeralPool


def _internal_key_ok(request: web.Request) -> bool:
    expected = os.environ.get("LIVEKIT_API_KEY", "")
    return bool(expected) and request.headers.get("X-Internal-Key") == expected


def create_routes(player: Player, pool: EphemeralPool) -> web.RouteTableDef:
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

    # ── External (client-piped) source ───────────────────

    @routes.post("/external/end")
    async def external_end(request):
        if not _internal_key_ok(request):
            return web.json_response({"error": "Forbidden"}, status=403)
        body = await request.json() if request.can_read_body else {}
        session_id = body.get("sessionId") if isinstance(body, dict) else None
        ended = await player.end_external(session_id)
        return web.json_response({"ok": ended})

    @routes.get("/external")
    async def external_ws(request):
        if not _internal_key_ok(request):
            return web.Response(status=403, text="Forbidden")
        ws = web.WebSocketResponse(
            heartbeat=5.0,  # aiohttp pings every 5s, closes on no pong
            max_msg_size=BYTES_PER_FRAME * 4,
        )
        await ws.prepare(request)

        session_id: str | None = None
        exit_reason = "loop-completed"
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                    except json.JSONDecodeError:
                        await ws.send_json({"type": "error", "message": "bad json"})
                        continue
                    ctype = data.get("type")
                    if ctype == "start":
                        if session_id is not None:
                            await ws.send_json({"type": "error", "message": "already started"})
                            continue
                        new_id = str(data.get("sessionId") or uuid.uuid4())
                        ok = await player.start_external({
                            "id": new_id,
                            "title": (data.get("title") or "External stream")[:256],
                            "addedBy": (data.get("addedBy") or "Unknown")[:64],
                        })
                        if not ok:
                            await ws.send_json({"type": "busy"})
                            await ws.close(code=4009, message=b"busy")
                            exit_reason = "busy-rejected"
                            break
                        session_id = new_id
                        print(f"[api] external ws started session={new_id}")
                        await ws.send_json({"type": "started", "sessionId": new_id})
                    elif ctype == "end":
                        print(f"[api] external ws got explicit end for session={session_id}")
                        if session_id:
                            await player.end_external(session_id)
                            await ws.send_json({"type": "ended"})
                            session_id = None
                        await ws.close()
                        exit_reason = "explicit-end-message"
                        break
                    else:
                        await ws.send_json({"type": "error", "message": "unknown type"})
                elif msg.type == WSMsgType.BINARY:
                    if not session_id:
                        continue  # ignore frames before start
                    if len(msg.data) != BYTES_PER_FRAME:
                        # Silently drop off-size frames; keeps the loop pacing clean.
                        continue
                    await player.feed_external(session_id, msg.data)
                elif msg.type == WSMsgType.ERROR:
                    print(f"[api] external ws error: {ws.exception()}")
                    exit_reason = f"ws-error: {ws.exception()}"
                    break
        finally:
            print(
                f"[api] external ws finalize: reason={exit_reason} "
                f"session_still_held={session_id is not None} ws_closed={ws.closed}"
            )
            if session_id:
                # Client vanished (disconnect, heartbeat timeout, error) — let
                # the radio resume. Safe no-op if the session was already torn down.
                await player.end_external(session_id)

        return ws

    # ── Ephemeral per-room pipe ──────────────────────────

    @routes.get("/ephemeral")
    async def ephemeral_ws(request):
        """PCM pipe for non-Music rooms. The API relay hands us the LiveKit
        connection details in the `start` control frame, we spin up a fresh
        EphemeralSession, feed frames until end/close, then tear it down."""
        if not _internal_key_ok(request):
            return web.Response(status=403, text="Forbidden")
        ws = web.WebSocketResponse(
            heartbeat=5.0,
            max_msg_size=BYTES_PER_FRAME * 4,
        )
        await ws.prepare(request)

        session_id: str | None = None
        exit_reason = "loop-completed"
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                    except json.JSONDecodeError:
                        await ws.send_json({"type": "error", "message": "bad json"})
                        continue
                    ctype = data.get("type")
                    if ctype == "start":
                        if session_id is not None:
                            await ws.send_json({"type": "error", "message": "already started"})
                            continue
                        new_id = str(data.get("sessionId") or uuid.uuid4())
                        room_name = str(data.get("roomName") or "").strip()
                        lk_token = str(data.get("lkToken") or "")
                        e2ee_b64 = data.get("e2eeKey")
                        identity = str(data.get("identity") or "").strip()
                        display_name = str(data.get("displayName") or "").strip()
                        title = str(data.get("title") or "").strip()[:200]
                        if not room_name or not lk_token or not identity:
                            await ws.send_json({"type": "error", "message": "missing fields"})
                            await ws.close(code=4400, message=b"missing fields")
                            exit_reason = "bad-start"
                            break
                        # LiveKit's Python shared_key expects the base64 string
                        # encoded as UTF-8 bytes (the key material is the ASCII
                        # text, not the raw digest). Mirrors MusicBot._connect.
                        e2ee_key = e2ee_b64.encode() if e2ee_b64 else None
                        livekit_url = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7881")
                        try:
                            await pool.create(
                                session_id=new_id,
                                livekit_url=livekit_url,
                                room_name=room_name,
                                lk_token=lk_token,
                                e2ee_key=e2ee_key,
                                identity=identity,
                                display_name=display_name,
                                title=title,
                            )
                        except Exception as e:
                            print(f"[api] ephemeral start failed: {e}")
                            await ws.send_json({"type": "error", "message": f"start failed: {e}"})
                            await ws.close(code=4500, message=b"start failed")
                            exit_reason = f"start-failed: {e}"
                            break
                        session_id = new_id
                        print(f"[api] ephemeral ws started session={new_id} room={room_name}")
                        await ws.send_json({"type": "started", "sessionId": new_id})
                    elif ctype == "end":
                        print(f"[api] ephemeral ws got explicit end for session={session_id}")
                        if session_id:
                            await pool.end(session_id)
                            await ws.send_json({"type": "ended"})
                            session_id = None
                        await ws.close()
                        exit_reason = "explicit-end-message"
                        break
                    else:
                        await ws.send_json({"type": "error", "message": "unknown type"})
                elif msg.type == WSMsgType.BINARY:
                    if not session_id:
                        continue
                    if len(msg.data) != BYTES_PER_FRAME:
                        continue
                    session = pool.get(session_id)
                    if session is not None:
                        await session.feed(msg.data)
                elif msg.type == WSMsgType.ERROR:
                    print(f"[api] ephemeral ws error: {ws.exception()}")
                    exit_reason = f"ws-error: {ws.exception()}"
                    break
        finally:
            print(
                f"[api] ephemeral ws finalize: reason={exit_reason} "
                f"session_still_held={session_id is not None} ws_closed={ws.closed}"
            )
            if session_id:
                await pool.end(session_id)

        return ws

    return routes
