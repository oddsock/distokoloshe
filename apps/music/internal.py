import hashlib
import hmac
import os


def internal_key() -> str:
    """Shared API<->bot secret, derived from LIVEKIT_API_SECRET so it never leaves
    the server. (LIVEKIT_API_KEY can't be used: it's the `iss` claim of every
    LiveKit token handed to clients.) Must match apps/server/src/routes/music.ts."""
    secret = os.environ.get("LIVEKIT_API_SECRET", "")
    return hmac.new(secret.encode(), b"distokoloshe-internal", hashlib.sha256).hexdigest()
