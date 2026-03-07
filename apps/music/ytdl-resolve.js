#!/usr/bin/env node
// Resolve a YouTube URL to a direct audio stream using @distube/ytdl-core
const ytdl = require("@distube/ytdl-core");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node ytdl-resolve.js <youtube-url>");
  process.exit(1);
}

(async () => {
  try {
    const info = await ytdl.getInfo(url);
    // Filter audio-only formats, sort by bitrate descending
    const audioFormats = ytdl
      .filterFormats(info.formats, "audioonly")
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    if (audioFormats.length === 0) {
      console.error("No audio formats found");
      process.exit(1);
    }

    // Print the best audio URL to stdout
    console.log(audioFormats[0].url);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
})();
