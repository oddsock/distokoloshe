import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send } from 'lucide-react';
import * as api from '../lib/api';
import { resizeImage } from '../lib/imageResize';

const MAX_TEXT = 200;
const ALLOWED_IMAGES = 'image/png,image/jpeg,image/webp,image/gif';

type Upload = { phase: 'preparing' } | { phase: 'uploading'; pct: number } | { phase: 'error'; message: string } | null;

interface ChatComposerProps {
  roomName: string | null;
  /** Sending needs a live room connection */
  connected: boolean;
}

/** Message box for the Chat tab: text up to 200 chars plus one image (paste or attach). */
export function ChatComposer({ roomName, connected }: ChatComposerProps) {
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: repeat Enter presses during an upload must not start more sends.
  const sendingRef = useRef(false);
  const busy = upload?.phase === 'preparing' || upload?.phase === 'uploading';

  const clearImage = useCallback(() => {
    setPendingImage(null);
    setUpload(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const pickImage = useCallback((file: Blob) => {
    if (sendingRef.current) return;
    setPendingImage(file);
    setUpload(null);
    setSendError(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const send = useCallback(async () => {
    if (sendingRef.current || !connected) return;
    const text = input.trim();
    if (!text && !pendingImage) return;
    setSendError(null);

    let imageId: string | undefined;
    if (pendingImage) {
      sendingRef.current = true;
      try {
        setUpload({ phase: 'preparing' });
        // Server caps chat images at 4MB. Re-encoding also strips EXIF/GPS
        // metadata; GIFs under the cap pass through untouched so they stay animated.
        const isGif = pendingImage.type === 'image/gif';
        const full = isGif && pendingImage.size <= 4_000_000
          ? pendingImage
          : await resizeImage(pendingImage, 3840, 4_000_000);
        // Small preview for bubbles and history, so nobody downloads the full image to see it.
        const thumb = isGif && pendingImage.size <= 200_000
          ? pendingImage
          : await resizeImage(pendingImage, 480, 200_000);
        setUpload({ phase: 'uploading', pct: 0 });
        const res = await api.uploadChatImage(full, thumb, (pct) => setUpload({ phase: 'uploading', pct }));
        imageId = res.imageId;
      } catch (err) {
        // Keep the image and text so the user can retry (Enter) or remove the image.
        setUpload({ phase: 'error', message: err instanceof api.ApiError ? err.message : 'Image upload failed' });
        return;
      } finally {
        sendingRef.current = false;
      }
      clearImage();
    }
    try {
      await api.sendChatMessage(text || undefined, imageId);
      setInput('');
    } catch (err) {
      setSendError(err instanceof api.ApiError ? err.message : 'Message not sent');
    }
  }, [connected, input, pendingImage, clearImage]);

  const error = upload?.phase === 'error' ? `${upload.message} — press Enter to retry` : sendError;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 p-2.5 flex flex-col gap-2 shrink-0">
      {error && <p className="text-xs text-red-500 px-1" role="alert">{error}</p>}
      {preview && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="relative shrink-0">
            <img src={preview} className={`h-10 w-10 rounded-md object-cover ${upload?.phase === 'error' ? 'ring-2 ring-red-500' : ''}`} alt="" />
            {busy && (
              <div className="absolute inset-0 rounded-md bg-black/55 flex items-center justify-center text-[10px] font-semibold text-white" aria-live="polite">
                {upload?.phase === 'uploading' ? `${upload.pct}%` : <Loader2 size={14} className="animate-spin" aria-label="Preparing image" />}
              </div>
            )}
          </div>
          <span className="flex-1 truncate">{busy ? (upload?.phase === 'uploading' ? 'Uploading…' : 'Preparing…') : 'Image attached'}</span>
          {!busy && (
            <button onClick={clearImage} className="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500" aria-label="Remove image" data-tooltip="Remove image">
              Remove
            </button>
          )}
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || !connected}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Attach image"
          data-tooltip="Attach image (or paste one)"
        >
          <ImagePlus size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_IMAGES}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickImage(file);
            e.target.value = '';
          }}
        />
        <input
          type="text"
          value={input}
          readOnly={busy}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_TEXT))}
          onKeyDown={(e) => {
            // Enter that confirms an IME composition must not send (Safari submits on it)
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              pickImage(file);
            }
          }}
          placeholder={!connected ? 'Connecting…' : busy ? 'Sending image…' : roomName ? `Message ${roomName}` : 'Send a message…'}
          maxLength={MAX_TEXT}
          className={`flex-1 min-w-0 px-3 py-2 rounded-lg text-sm ${busy ? 'opacity-60' : ''} bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 focus:border-indigo-500 outline-none placeholder-zinc-400 dark:placeholder-zinc-500 disabled:opacity-60`}
        />
        <button
          type="submit"
          disabled={busy || !connected || (!input.trim() && !pendingImage)}
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Send"
          data-tooltip="Send (Enter)"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
