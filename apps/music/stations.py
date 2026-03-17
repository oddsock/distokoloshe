# All stations below use Creative Commons or public-domain licensed music
# and permit retransmission. Users may add their own stations to this list.

STATIONS = [
    # Musopen Radio — public-domain classical recordings (musopen.org)
    {"id": "musopen", "name": "Musopen Classical", "genre": "Classical", "url": "http://streaming.musopen.org:8085/musopen"},

    # Radio Schizoid — Creative Commons (CC BY-NC-SA) psybient/ambient (radioschizoid.in)
    {"id": "schizoid-chill", "name": "Radio Schizoid — Chill", "genre": "Ambient/Psybient", "url": "http://94.130.113.214:8000/chill"},
    {"id": "schizoid-psychedelic", "name": "Radio Schizoid — Psychedelic", "genre": "Psychedelic", "url": "http://94.130.113.214:8000/psychedelic"},

    # Jamendo Radio — Creative Commons licensed music (jamendo.com)
    {"id": "jam-chillout", "name": "Jamendo Chillout", "genre": "Chillout", "url": "https://streaming.jamendo.com/JamChillout"},
    {"id": "jam-lounge", "name": "Jamendo Lounge", "genre": "Lounge", "url": "https://streaming.jamendo.com/JamLounge"},
    {"id": "jam-ambient", "name": "Jamendo Ambient", "genre": "Ambient", "url": "https://streaming.jamendo.com/JamAmbient"},
    {"id": "jam-electronic", "name": "Jamendo Electronic", "genre": "Electronic", "url": "https://streaming.jamendo.com/JamElectro"},
    {"id": "jam-rock", "name": "Jamendo Rock", "genre": "Rock", "url": "https://streaming.jamendo.com/JamRock"},
    {"id": "jam-pop", "name": "Jamendo Pop", "genre": "Pop", "url": "https://streaming.jamendo.com/JamPop"},
    {"id": "jam-hiphop", "name": "Jamendo Hip-Hop", "genre": "Hip-Hop", "url": "https://streaming.jamendo.com/JamHiphop"},
    {"id": "jam-jazz", "name": "Jamendo Jazz", "genre": "Jazz", "url": "https://streaming.jamendo.com/JamJazz"},
    {"id": "jam-metal", "name": "Jamendo Metal", "genre": "Metal", "url": "https://streaming.jamendo.com/JamMetal"},
]

DEFAULT_STATION_ID = "jam-chillout"


def get_station(station_id: str):
    return next((s for s in STATIONS if s["id"] == station_id), None)
