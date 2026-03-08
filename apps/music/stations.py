STATIONS = [
    # SomaFM — using 256kbps MP3 streams for best quality before Opus re-encoding
    {"id": "groovesalad", "name": "Groove Salad", "genre": "Chill", "url": "https://ice2.somafm.com/groovesalad-256-mp3"},
    {"id": "dronezone", "name": "Drone Zone", "genre": "Ambient", "url": "https://ice2.somafm.com/dronezone-256-mp3"},
    {"id": "defcon", "name": "DEF CON Radio", "genre": "Electronic", "url": "https://ice2.somafm.com/defcon-256-mp3"},
    {"id": "indiepop", "name": "Indie Pop Rocks", "genre": "Indie Pop", "url": "https://ice2.somafm.com/indiepop-256-mp3"},
    {"id": "secretagent", "name": "Secret Agent", "genre": "Lounge", "url": "https://ice2.somafm.com/secretagent-256-mp3"},
    {"id": "spacestation", "name": "Space Station Soma", "genre": "Space", "url": "https://ice2.somafm.com/spacestation-256-mp3"},
    {"id": "lush", "name": "Lush", "genre": "Downtempo", "url": "https://ice2.somafm.com/lush-256-mp3"},
    {"id": "thetrip", "name": "The Trip", "genre": "Progressive", "url": "https://ice2.somafm.com/thetrip-256-mp3"},
    {"id": "cliqhop", "name": "cliqhop idm", "genre": "IDM", "url": "https://ice2.somafm.com/cliqhop-256-mp3"},
    {"id": "dubstep", "name": "Dub Step Beyond", "genre": "Dubstep", "url": "https://ice2.somafm.com/dubstep-256-mp3"},
    {"id": "deepspaceone", "name": "Deep Space One", "genre": "Deep House", "url": "https://ice2.somafm.com/deepspaceone-256-mp3"},
    {"id": "seventies", "name": "Left Coast 70s", "genre": "70s Rock", "url": "https://ice2.somafm.com/seventies-256-mp3"},
    {"id": "bootliquor", "name": "Boot Liquor", "genre": "Americana", "url": "https://ice2.somafm.com/bootliquor-256-mp3"},
    {"id": "metal", "name": "Metal Detector", "genre": "Metal", "url": "https://ice2.somafm.com/metal-256-mp3"},
    {"id": "fluid", "name": "Fluid", "genre": "Instrumental Hip-Hop", "url": "https://ice2.somafm.com/fluid-256-mp3"},
    {"id": "vaporwaves", "name": "Vaporwaves", "genre": "Vaporwave", "url": "https://ice2.somafm.com/vaporwaves-256-mp3"},
    # Other stations
    {"id": "nightwave", "name": "Nightwave Plaza", "genre": "Vaporwave/Future Funk", "url": "https://radio.plaza.one/mp3"},
    {"id": "jazz24", "name": "Jazz24", "genre": "Jazz", "url": "https://live.wostreaming.net/direct/ppm-jazz24mp3-ibc1"},
    {"id": "kexp", "name": "KEXP 90.3 FM", "genre": "Eclectic/Indie", "url": "https://kexp-mp3-128.streamguys1.com/kexp128.mp3"},
    {"id": "wfmu", "name": "WFMU Freeform", "genre": "Freeform", "url": "https://stream0.wfmu.org/freeform-128k"},
    {"id": "classical", "name": "Classical KUSC", "genre": "Classical", "url": "https://kusc.streamguys1.com/kusc-128k.mp3"},
    {"id": "bluesmix", "name": "BluesMix", "genre": "Blues", "url": "https://streams.radiobob.de/bob-blues/mp3-192/streams.radiobob.de/"},
    {"id": "reggae", "name": "Reggae141", "genre": "Reggae", "url": "https://listen.181fm.com/181-reggae_128k.mp3"},
    {"id": "hiphop", "name": "HipHop Forever", "genre": "Hip-Hop", "url": "https://listen.181fm.com/181-hiphop_128k.mp3"},
]

DEFAULT_STATION_ID = "groovesalad"


def get_station(station_id: str):
    return next((s for s in STATIONS if s["id"] == station_id), None)
