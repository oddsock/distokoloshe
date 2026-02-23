import { useState, useRef } from 'react';
import { Room as LiveKitRoom } from 'livekit-client';
import { Upload, Trash2, Play, Square, Loader2 } from 'lucide-react';
import type { SoundboardClip } from '../lib/api';

interface SoundboardProps {
  clips: SoundboardClip[];
  playingId: number | null;
  userId: number;
  room: LiveKitRoom;
  onPlay: (clipId: number) => void;
  onStop: () => void;
  onUpload: (name: string, file: File) => Promise<string | null>;
  onDelete: (clipId: number) => Promise<string | null>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function Soundboard({ clips, playingId, userId, onPlay, onStop, onUpload, onDelete }: SoundboardProps) {
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    }
  };

  const handleDelete = async (clipId: number) => {
    const err = await onDelete(clipId);
    if (err) setError(err);
  };

  return (
    <div
      className="absolute bottom-full mb-2 right-0 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[340px] z-50 max-h-[400px] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase text-zinc-500 block mb-2">Soundboard</span>

      {/* Error banner */}
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1 mb-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      {/* Clip list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mb-3">
        {clips.length === 0 ? (
          <p className="text-xs text-zinc-500 py-2 text-center">No clips yet — upload one!</p>
        ) : (
          clips.map((clip) => {
            const isPlaying = playingId === clip.id;
            const isAnyPlaying = playingId != null;
            return (
              <div
                key={clip.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                  isPlaying
                    ? 'bg-indigo-500/20'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'
                }`}
              >
                <button
                  onClick={() => isPlaying ? onStop() : onPlay(clip.id)}
                  disabled={isAnyPlaying && !isPlaying}
                  className={`flex-shrink-0 p-1 rounded transition-colors ${
                    isPlaying
                      ? 'text-indigo-400 hover:text-indigo-300'
                      : isAnyPlaying
                        ? 'text-zinc-400 opacity-50 cursor-not-allowed'
                        : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {isPlaying ? <Square size={14} /> : <Play size={14} />}
                </button>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs block truncate ${isPlaying ? 'text-indigo-400 font-medium' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {clip.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {formatSize(clip.size)} · {clip.uploaderName}
                  </span>
                </div>
                {clip.uploaded_by === userId && (
                  <button
                    onClick={() => handleDelete(clip.id)}
                    className="flex-shrink-0 p-1 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Upload section */}
      <div className="border-t border-zinc-200 dark:border-zinc-600 pt-3 space-y-2">
        <input
          type="text"
          value={uploadName}
          onChange={(e) => setUploadName(e.target.value)}
          placeholder="Clip name"
          maxLength={64}
          className="w-full text-xs px-2 py-1.5 rounded bg-zinc-100 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          <label className="flex-1 flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-zinc-100 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 text-zinc-500 cursor-pointer hover:border-indigo-500 transition-colors truncate">
            <Upload size={12} />
            <span className="truncate">{uploadFile ? uploadFile.name : 'Choose file'}</span>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
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
            className="px-3 py-1.5 text-xs rounded bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
