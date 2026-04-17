import { useState } from 'react';
import {
  type MusicStatus,
  removeFromMusicQueue,
  skipMusicTrack,
  setMusicStation,
  toggleMusicPause,
} from '../lib/api';
import type { PipeController } from '../hooks/usePipePlayer';
import { PipePanel } from './PipePanel';

interface MusicControlsProps {
  isMobile?: boolean;
  status: MusicStatus | null;
  onRefresh: () => void;
  pipe: PipeController;
}

export function MusicControls({ isMobile, status, onRefresh, pipe }: MusicControlsProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePause = async () => {
    setBusy(true);
    try {
      await toggleMusicPause();
      onRefresh();
    } catch { setError('Failed to toggle pause'); }
    setBusy(false);
  };

  const handleSkip = async () => {
    setBusy(true);
    try {
      await skipMusicTrack();
      onRefresh();
    } catch { setError('Failed to skip'); }
    setBusy(false);
  };

  const handleStation = async (stationId: string) => {
    setBusy(true);
    try {
      await setMusicStation(stationId);
      onRefresh();
    } catch { setError('Failed to switch station'); }
    setBusy(false);
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFromMusicQueue(id);
      onRefresh();
    } catch { setError('Failed to remove'); }
  };

  const containerClass = isMobile
    ? 'fixed bottom-16 left-2 right-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 z-50 max-h-[70vh] overflow-y-auto'
    : 'absolute bottom-full mb-2 right-0 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[340px] z-50 max-h-[70vh] overflow-y-auto';

  if (!status) {
    return (
      <div className={containerClass} onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Connecting to music bot...</p>
      </div>
    );
  }

  return (
    <div className={containerClass} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">DJ Tokoloshe</h3>
        <div className="flex gap-1">
          <button
            onClick={handlePause}
            disabled={busy}
            className="px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
            title={status.paused ? 'Resume' : 'Pause'}
          >
            {status.paused ? '\u25B6' : '\u23F8'}
          </button>
          {status.mode === 'queue' && (
            <button
              onClick={handleSkip}
              disabled={busy}
              className="px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
              title="Skip"
            >
              {'\u23ED'}
            </button>
          )}
        </div>
      </div>

      {/* Now Playing */}
      <div className="mb-3 px-2 py-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Now Playing</p>
        <p className="text-sm text-zinc-900 dark:text-zinc-200 truncate">
          {status.paused ? '(Paused) ' : ''}{status.nowPlaying || 'Nothing playing'}
        </p>
        {status.mode === 'radio' && status.currentStation && (
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{status.currentStation.name} &middot; {status.currentStation.genre}</p>
        )}
        {status.mode === 'external' && status.streamer && (
          <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5">Piped by {status.streamer}</p>
        )}
      </div>

      <PipePanel pipe={pipe} />

      {/* Radio Station */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Radio Station</label>
        <select
          value={status.currentStation?.id || ''}
          onChange={(e) => handleStation(e.target.value)}
          disabled={busy}
          className="w-full px-2 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 focus:border-indigo-500 outline-none"
        >
          {status.stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.genre})</option>
          ))}
        </select>
      </div>


      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mb-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      {/* Queue */}
      {status.queue.length > 0 && (
        <div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">Queue ({status.queue.length})</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {status.queue.map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs bg-zinc-100 dark:bg-zinc-900 rounded px-2 py-1">
                <span className="text-zinc-500 w-4 text-right">{i + 1}.</span>
                <span className="text-zinc-900 dark:text-zinc-200 flex-1 truncate">{entry.title}</span>
                <span className="text-zinc-500 truncate max-w-[60px]">{entry.addedBy}</span>
                <button
                  onClick={() => handleRemove(entry.id)}
                  className="text-zinc-400 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  {'\u2715'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
