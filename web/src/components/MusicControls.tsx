import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type MusicStatus,
  getMusicStatus,
  addToMusicQueue,
  removeFromMusicQueue,
  skipMusicTrack,
  setMusicStation,
  toggleMusicPause,
  getStoredToken,
} from '../lib/api';

interface MusicControlsProps {
  isMobile?: boolean;
}

export function MusicControls({ isMobile }: MusicControlsProps) {
  const [status, setStatus] = useState<MusicStatus | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create audio element on mount
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume / 100;
    audioRef.current = audio;

    audio.addEventListener('playing', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('ended', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  // Poll status every 5 seconds
  useEffect(() => {
    const fetchStatus = () => {
      getMusicStatus().then(setStatus).catch(() => {});
    };
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const refreshStatus = useCallback(() => {
    getMusicStatus().then(setStatus).catch(() => {});
  }, []);

  const handlePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      // Set stream URL with auth token
      const token = getStoredToken();
      audio.src = `/api/music/stream?token=${encodeURIComponent(token || '')}`;
      try {
        await audio.play();
      } catch {
        setError('Failed to play audio');
      }
    }
  };

  const handleServerPause = async () => {
    setBusy(true);
    try {
      await toggleMusicPause();
      refreshStatus();
    } catch { setError('Failed to toggle pause'); }
    setBusy(false);
  };

  const handleSkip = async () => {
    setBusy(true);
    try {
      await skipMusicTrack();
      refreshStatus();
    } catch { setError('Failed to skip'); }
    setBusy(false);
  };

  const handleStation = async (stationId: string) => {
    setBusy(true);
    try {
      await setMusicStation(stationId);
      refreshStatus();
    } catch { setError('Failed to switch station'); }
    setBusy(false);
  };

  const handleVolume = (vol: number) => {
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol / 100;
    }
  };

  const handleAddToQueue = async () => {
    if (!urlInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addToMusicQueue(urlInput.trim(), titleInput.trim() || undefined);
      setUrlInput('');
      setTitleInput('');
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to queue');
    }
    setBusy(false);
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFromMusicQueue(id);
      refreshStatus();
    } catch { setError('Failed to remove'); }
  };

  if (!status) {
    return (
      <div
        className={isMobile
          ? 'fixed bottom-16 left-2 right-2 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 z-50'
          : 'absolute bottom-full mb-2 right-0 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 w-[320px] z-50'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-zinc-400 text-sm">Connecting to music bot...</p>
      </div>
    );
  }

  return (
    <div
      className={isMobile
        ? 'fixed bottom-16 left-2 right-2 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 z-50 max-h-[70vh] overflow-y-auto'
        : 'absolute bottom-full mb-2 right-0 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-4 w-[320px] z-50 max-h-[70vh] overflow-y-auto'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">DJ Tokoloshe</h3>
        <div className="flex gap-1">
          {/* Client-side play/pause (audio element) */}
          <button
            onClick={handlePlayPause}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isPlaying
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-zinc-700 hover:bg-zinc-600 text-white'
            }`}
            title={isPlaying ? 'Stop listening' : 'Start listening'}
          >
            {isPlaying ? '\u23F8' : '\u25B6'}
          </button>
          {/* Server-side pause (pause the stream for everyone) */}
          <button
            onClick={handleServerPause}
            disabled={busy}
            className="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-white transition-colors disabled:opacity-50"
            title={status.paused ? 'Resume stream' : 'Pause stream'}
          >
            {status.paused ? '\u25B6\u25B6' : '\u23F9'}
          </button>
          {status.mode === 'queue' && (
            <button
              onClick={handleSkip}
              disabled={busy}
              className="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-white transition-colors disabled:opacity-50"
              title="Skip"
            >
              {'\u23ED'}
            </button>
          )}
        </div>
      </div>

      {/* Now Playing */}
      <div className="mb-3 px-2 py-1.5 bg-zinc-900 rounded-lg">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Now Playing</p>
        <p className="text-sm text-zinc-200 truncate">
          {status.paused ? '(Paused) ' : ''}{status.nowPlaying || 'Nothing playing'}
        </p>
        {status.mode === 'radio' && status.currentStation && (
          <p className="text-[10px] text-zinc-500 mt-0.5">{status.currentStation.name} &middot; {status.currentStation.genre}</p>
        )}
      </div>

      {/* Volume (client-side) */}
      <div className="mb-3">
        <label className="text-xs text-zinc-400 block mb-1">Volume: {volume}%</label>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolume(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
      </div>

      {/* Radio Station */}
      <div className="mb-3">
        <label className="text-xs text-zinc-400 block mb-1">Radio Station</label>
        <select
          value={status.currentStation?.id || ''}
          onChange={(e) => handleStation(e.target.value)}
          disabled={busy}
          className="w-full bg-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 border border-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {status.stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.genre})</option>
          ))}
        </select>
      </div>

      {/* Add to Queue */}
      <div className="mb-3">
        <label className="text-xs text-zinc-400 block mb-1">Add to Queue</label>
        <div className="flex gap-1 mb-1">
          <input
            type="text"
            placeholder="Audio URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddToQueue()}
            className="flex-1 bg-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 border border-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-zinc-500"
          />
          <button
            onClick={handleAddToQueue}
            disabled={busy || !urlInput.trim()}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <input
          type="text"
          placeholder="Title (optional)"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddToQueue()}
          className="w-full bg-zinc-700 text-white text-sm rounded-lg px-2 py-1.5 border border-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-zinc-500"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-amber-400 mb-2" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {/* Queue */}
      {status.queue.length > 0 && (
        <div>
          <p className="text-xs text-zinc-400 mb-1">Queue ({status.queue.length})</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {status.queue.map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs bg-zinc-900 rounded px-2 py-1">
                <span className="text-zinc-500 w-4 text-right">{i + 1}.</span>
                <span className="text-zinc-200 flex-1 truncate">{entry.title}</span>
                <span className="text-zinc-500 truncate max-w-[60px]">{entry.addedBy}</span>
                <button
                  onClick={() => handleRemove(entry.id)}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
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
