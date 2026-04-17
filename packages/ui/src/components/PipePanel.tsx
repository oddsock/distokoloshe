import { useState } from 'react';
import type { PipeController } from '../hooks/usePipePlayer';

interface PipePanelProps {
  pipe: PipeController;
}

/**
 * Inline pipe controller embedded inside MusicControls (desktop only).
 * Lets the streamer paste a URL or pick a local file, then play / stop.
 * The audio is decoded by the bundled ffmpeg/yt-dlp sidecars and uploaded
 * to the music bot, so everyone in the room hears it on the DJ track.
 */
export function PipePanel({ pipe }: PipePanelProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  if (!pipe.available) return null;

  const isActive = pipe.state === 'starting' || pipe.state === 'playing';

  const handleStartUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await pipe.startUrl(url.trim());
      setUrl('');
    } catch {
      /* error surfaced via pipe.error */
    }
    setBusy(false);
  };

  const handlePickFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pipe.startFile();
    } catch {
      /* error surfaced via pipe.error */
    }
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    await pipe.stop();
    setBusy(false);
  };

  return (
    <div className="mb-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
        Pipe from your device
      </label>

      {isActive ? (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
          <span className="flex-1 text-xs text-zinc-900 dark:text-zinc-200 truncate">
            {pipe.state === 'starting' ? 'Starting…' : pipe.title || 'Streaming'}
          </span>
          <button
            onClick={handleStop}
            disabled={busy}
            className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
            title="Stop pipe"
          >
            Stop
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-1 mb-1">
            <input
              type="text"
              placeholder="URL (YouTube, SoundCloud, …)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartUrl()}
              disabled={busy}
              className="flex-1 px-2 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 focus:border-indigo-500 outline-none placeholder-zinc-400 dark:placeholder-zinc-500 disabled:opacity-50"
            />
            <button
              onClick={handleStartUrl}
              disabled={busy || !url.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              Play
            </button>
          </div>
          <button
            onClick={handlePickFile}
            disabled={busy}
            className="w-full px-2 py-1.5 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
          >
            Pick local audio file…
          </button>
        </>
      )}

      {pipe.error && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400 truncate" title={pipe.error}>
          {pipe.error}
        </p>
      )}
    </div>
  );
}
