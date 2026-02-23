import { useState, useRef } from 'react';
import { Volume2, Volume1, VolumeX, Trash2, Plus, Loader2, Square, Play } from 'lucide-react';
import type { SoundboardClip } from '../lib/api';

interface SoundboardProps {
  clips: SoundboardClip[];
  playingId: number | null;
  previewingId: number | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  onPlay: (clipId: number) => void;
  onStop: () => void;
  onPreview: (clipId: number) => void;
  onStopPreview: () => void;
  onUpload: (name: string, file: File) => Promise<string | null>;
  onDelete: (clipId: number) => Promise<string | null>;
}

export function Soundboard({ clips, playingId, previewingId, volume, onVolumeChange, onPlay, onStop, onPreview, onStopPreview, onUpload, onDelete }: SoundboardProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    setError(null);
    const err = await onUpload(uploadName.trim(), uploadFile);
    setUploading(false);
    if (err) {
      setError(err);
    } else {
      setUploadName('');
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setShowUpload(false);
    }
  };

  const handleDelete = async (clipId: number) => {
    const err = await onDelete(clipId);
    if (err) setError(err);
    setConfirmDelete(null);
  };

  return (
    <div
      className="absolute bottom-full mb-2 right-0 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[min(420px,calc(100vw-2rem))] z-50 max-h-[400px] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Soundboard</h3>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => onVolumeChange(volume > 0 ? 0 : 0.5)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            data-tooltip={volume === 0 ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? <VolumeX size={14} /> : volume < 0.5 ? <Volume1 size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-20 h-1 accent-indigo-500"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1 mb-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      {/* Clip grid */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-1">
        {clips.length === 0 && !showUpload ? (
          <p className="text-xs text-zinc-500 py-4 text-center">No clips yet — add one!</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {clips.map((clip) => {
              const isPlaying = playingId === clip.id;
              const isPreviewing = previewingId === clip.id;
              const isActive = isPlaying || isPreviewing;
              const isConfirming = confirmDelete === clip.id;
              const canPlay = playingId == null || isPlaying;

              return (
                <div key={clip.id} className="relative flex flex-col">
                  {/* Delete confirmation overlay */}
                  {isConfirming && (
                    <div className="absolute inset-0 z-10 bg-zinc-800/90 rounded-lg flex flex-col items-center justify-center gap-1 p-1">
                      <span className="text-[10px] text-zinc-300 text-center">Delete?</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleDelete(clip.id)}
                          className="text-[10px] px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-[10px] px-2 py-0.5 rounded bg-zinc-600 text-zinc-200 hover:bg-zinc-500 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}

                  <div className={`group flex items-center rounded-lg transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}>
                    {/* Preview (local) button */}
                    <button
                      onClick={() => isPreviewing ? onStopPreview() : onPreview(clip.id)}
                      className={`flex-shrink-0 p-1.5 rounded-l-lg transition-colors ${
                        isPreviewing
                          ? 'text-indigo-400 hover:text-indigo-300'
                          : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
                      }`}
                      title="Preview locally"
                    >
                      {isPreviewing ? <Square size={12} /> : <Volume2 size={12} />}
                    </button>

                    {/* Main play button (sends to room) */}
                    <button
                      onClick={() => isPlaying ? onStop() : onPlay(clip.id)}
                      disabled={!canPlay}
                      className={`flex-1 min-w-0 py-1.5 pr-1 text-left transition-colors relative ${
                        isPlaying
                          ? 'text-indigo-400'
                          : !canPlay
                            ? 'text-zinc-400 opacity-50 cursor-not-allowed'
                            : 'text-zinc-700 dark:text-zinc-200'
                      }`}
                    >
                      {/* Play icon overlay on hover */}
                      {canPlay && !isPlaying && (
                        <span className="absolute inset-0 flex items-center justify-center bg-zinc-200/80 dark:bg-zinc-600/80 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <Play size={16} className="text-zinc-600 dark:text-zinc-200" />
                        </span>
                      )}
                      {isPlaying && (
                        <span className="absolute inset-0 flex items-center justify-center bg-indigo-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <Square size={14} className="text-indigo-400" />
                        </span>
                      )}
                      <span className="text-xs font-medium block truncate leading-tight">{clip.name}</span>
                      <span className="text-[10px] italic text-zinc-400 dark:text-zinc-500 block truncate leading-tight">{clip.uploaderName}</span>
                    </button>

                    {/* Delete button (any user) */}
                    <button
                      onClick={() => setConfirmDelete(clip.id)}
                      className="flex-shrink-0 p-1.5 rounded-r-lg text-zinc-400 hover:text-red-400 transition-colors"
                      title="Delete clip"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add Sound button — always last in grid */}
            <button
              onClick={() => setShowUpload(!showUpload)}
              className={`flex items-center justify-center gap-1 rounded-lg py-2.5 text-xs font-medium transition-colors ${
                showUpload
                  ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/40'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              <Plus size={14} />
              Add Sound
            </button>
          </div>
        )}
      </div>

      {/* Upload section (expandable) */}
      {showUpload && (
        <div className="border-t border-zinc-200 dark:border-zinc-600 pt-2 mt-1 space-y-2">
          <input
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="Clip name"
            maxLength={64}
            className="w-full text-xs px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder-zinc-400 outline-none focus:border-indigo-500"
          />
          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-500 cursor-pointer hover:border-indigo-500 transition-colors truncate">
              <span className="truncate">{uploadFile ? uploadFile.name : 'Choose file...'}</span>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.ogg,.webm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setUploadFile(f);
                    if (!uploadName.trim()) {
                      setUploadName(f.name.replace(/\.[^.]+$/, ''));
                    }
                  }
                }}
              />
            </label>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile || !uploadName.trim()}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
