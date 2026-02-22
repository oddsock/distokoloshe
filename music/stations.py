STATIONS = [
    {"id": "groovesalad", "name": "Groove Salad", "genre": "Chill", "url": "https://ice2.somafm.com/groovesalad-128-mp3"},
    {"id": "dronezone", "name": "Drone Zone", "genre": "Ambient", "url": "https://ice2.somafm.com/dronezone-128-mp3"},
    {"id": "defcon", "name": "DEF CON Radio", "genre": "Electronic", "url": "https://ice2.somafm.com/defcon-128-mp3"},
    {"id": "indiepop", "name": "Indie Pop Rocks", "genre": "Indie Pop", "url": "https://ice2.somafm.com/indiepop-128-mp3"},
    {"id": "secretagent", "name": "Secret Agent", "genre": "Lounge", "url": "https://ice2.somafm.com/secretagent-128-mp3"},
    {"id": "spacestation", "name": "Space Station Soma", "genre": "Space", "url": "https://ice2.somafm.com/spacestation-128-mp3"},
]

DEFAULT_STATION_ID = "groovesalad"


def get_station(station_id: str):
    return next((s for s in STATIONS if s["id"] == station_id), None)
