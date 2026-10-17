"""Check that LiveKit webhooks enforce jail.

Joins a LiveKit room as the given user with a freshly signed token — what a replayed
pre-jail token looks like to the server — and reports whether the API kicks them.
Runs inside the music container, which has the LiveKit SDK and API credentials:

  docker compose exec -T music python - <username> "<room name>" < infra/scripts/check-jail-kick.py

Only use it with a user who is NOT currently in that room (normally: someone jailed
from it). LiveKit allows one connection per identity, so this would kick a real
session using the same username.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import sys
import time

from livekit import rtc


def mint_token(identity: str, room: str) -> str:
    now = int(time.time())
    claims = {
        "iss": os.environ["LIVEKIT_API_KEY"],
        "sub": identity,
        "name": identity,
        "iat": now,
        "nbf": now,
        "exp": now + 300,
        "video": {"roomJoin": True, "room": room, "canPublish": False, "canSubscribe": False},
    }

    def b64(data: dict) -> bytes:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=")

    signing_input = b64({"alg": "HS256", "typ": "JWT"}) + b"." + b64(claims)
    signature = base64.urlsafe_b64encode(
        hmac.new(os.environ["LIVEKIT_API_SECRET"].encode(), signing_input, hashlib.sha256).digest()
    ).rstrip(b"=")
    return (signing_input + b"." + signature).decode()


async def main(identity: str, room_name: str) -> None:
    room = rtc.Room()
    kicked = asyncio.Event()
    room.on("disconnected", lambda *_: kicked.set())
    await room.connect(os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7881"), mint_token(identity, room_name))
    print(f"Joined {room_name!r} as {identity!r} — waiting up to 10s to be kicked...")
    try:
        await asyncio.wait_for(kicked.wait(), 10)
        print("KICKED: jail enforcement works")
    except asyncio.TimeoutError:
        print("NOT kicked (expected only if this user isn't currently jailed from this room)")
        await room.disconnect()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit('usage: python - <username> "<room name>" < check-jail-kick.py')
    asyncio.run(main(sys.argv[1], sys.argv[2]))
