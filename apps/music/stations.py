STATIONS = [
    # SomaFM
    {"id": "groovesalad", "name": "Groove Salad", "genre": "Chill", "url": "https://ice2.somafm.com/groovesalad-128-aac"},
    {"id": "dronezone", "name": "Drone Zone", "genre": "Ambient", "url": "https://ice2.somafm.com/dronezone-128-aac"},
    {"id": "defcon", "name": "DEF CON Radio", "genre": "Electronic", "url": "https://ice2.somafm.com/defcon-128-aac"},
    {"id": "indiepop", "name": "Indie Pop Rocks", "genre": "Indie Pop", "url": "https://ice2.somafm.com/indiepop-128-aac"},
    {"id": "secretagent", "name": "Secret Agent", "genre": "Lounge", "url": "https://ice2.somafm.com/secretagent-128-aac"},
    {"id": "spacestation", "name": "Space Station Soma", "genre": "Space", "url": "https://ice2.somafm.com/spacestation-128-aac"},
    {"id": "lush", "name": "Lush", "genre": "Downtempo", "url": "https://ice2.somafm.com/lush-128-aac"},
    {"id": "thetrip", "name": "The Trip", "genre": "Progressive", "url": "https://ice2.somafm.com/thetrip-128-aac"},
    {"id": "cliqhop", "name": "cliqhop idm", "genre": "IDM", "url": "https://ice2.somafm.com/cliqhop-128-aac"},
    {"id": "dubstep", "name": "Dub Step Beyond", "genre": "Dubstep", "url": "https://ice2.somafm.com/dubstep-128-aac"},
    {"id": "deepspaceone", "name": "Deep Space One", "genre": "Deep House", "url": "https://ice2.somafm.com/deepspaceone-128-aac"},
    {"id": "seventies", "name": "Left Coast 70s", "genre": "70s Rock", "url": "https://ice2.somafm.com/seventies-128-aac"},
    {"id": "bootliquor", "name": "Boot Liquor", "genre": "Americana", "url": "https://ice2.somafm.com/bootliquor-128-aac"},
    {"id": "metal", "name": "Metal Detector", "genre": "Metal", "url": "https://ice2.somafm.com/metal-128-aac"},
    {"id": "fluid", "name": "Fluid", "genre": "Instrumental Hip-Hop", "url": "https://ice2.somafm.com/fluid-128-aac"},
    {"id": "vaporwaves", "name": "Vaporwaves", "genre": "Vaporwave", "url": "https://ice2.somafm.com/vaporwaves-128-aac"},
    # Other stations
    {"id": "nightwave", "name": "Nightwave Plaza", "genre": "Vaporwave/Future Funk", "url": "https://radio.plaza.one/mp3"},
    {"id": "jazz24", "name": "Jazz24", "genre": "Jazz", "url": "https://knkx-live-a.edge.audiocdn.com/6285_128k"},
    {"id": "kexp", "name": "KEXP 90.3 FM", "genre": "Eclectic/Indie", "url": "https://kexp-mp3-128.streamguys1.com/kexp128.mp3"},
    {"id": "wfmu", "name": "WFMU Freeform", "genre": "Freeform", "url": "https://stream0.wfmu.org/freeform-128k"},
    {"id": "classical", "name": "WQXR Classical", "genre": "Classical", "url": "https://stream.wqxr.org/wqxr"},
    {"id": "bluesmix", "name": "Radio BOB! 2000er Rock", "genre": "Rock", "url": "https://streams.radiobob.de/bob-blues/mp3-192/streams.radiobob.de/"},
    {"id": "reggae", "name": "Reggae141", "genre": "Reggae", "url": "https://listen.181fm.com/181-reggae_128k.mp3"},
    {"id": "hiphop", "name": "1Power", "genre": "Hip-Hop", "url": "http://live.powerhitz.com/1power"},
]

DEFAULT_STATION_ID = "groovesalad"


def get_station(station_id: str):
    return next((s for s in STATIONS if s["id"] == station_id), None)
