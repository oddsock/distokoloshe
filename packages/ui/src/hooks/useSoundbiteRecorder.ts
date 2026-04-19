import { useRef, useCallback, useEffect } from 'react';
import { Track } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';
import { encodeWav } from '../lib/encodeWav';

const isTauri = () => '__TAURI_INTERNALS__' in window;

const BUFFER_SECONDS = 10;
const PROCESSOR_BUFFER_SIZE = 4096;
const MUSIC_BOT_IDENTITY = '__music-bot__';

function isBotIdentity(identity: string): boolean {
  return identity === MUSIC_BOT_IDENTITY || identity.startsWith('__pipe-');
}

interface ParticipantRecording {
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  buffer: Float32Array;
  writeIndex: number;
  samplesFilled: number;
}

export function useSoundbiteRecorder() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordingsRef = useRef<Map<string, ParticipantRecording>>(new Map());

  const startRecording = useCallback((identity: string, publication: RemoteTrackPublication) => {
    if (publication.source !== Track.Source.Microphone) return;
    if (isBotIdentity(identity)) return;
    if (recordingsRef.current.has(identity)) return;

    const track = publication.track;
    if (!track?.mediaStreamTrack) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

    const bufferSize = Math.ceil(ctx.sampleRate * BUFFER_SECONDS);
    const ringBuffer = new Float32Array(bufferSize);
    const recording: ParticipantRecording = {
      source,
      processor,
      buffer: ringBuffer,
      writeIndex: 0,
      samplesFilled: 0,
    };

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        ringBuffer[recording.writeIndex] = input[i];
        recording.writeIndex = (recording.writeIndex + 1) % bufferSize;
      }
      recording.samplesFilled = Math.min(recording.samplesFilled + input.length, bufferSize);
    };

    source.connect(processor);
    processor.connect(ctx.destination);

    recordingsRef.current.set(identity, recording);
  }, []);

  const stopRecording = useCallback((identity: string) => {
    const recording = recordingsRef.current.get(identity);
    if (!recording) return;

    try {
      recording.processor.disconnect();
      recording.source.disconnect();
    } catch {}
    recordingsRef.current.delete(identity);
  }, []);

  /** Extract WAV blob + filename for a single participant (no I/O). */
  const extractSoundbite = useCallback((identity: string, displayName: string): { blob: Blob; fileName: string } | null => {
    const recording = recordingsRef.current.get(identity);
    if (!recording || recording.samplesFilled === 0) return null;

    const { buffer, writeIndex, samplesFilled } = recording;
    const samples = new Float32Array(samplesFilled);

    if (samplesFilled < buffer.length) {
      samples.set(buffer.subarray(0, samplesFilled));
    } else {
      const tail = buffer.subarray(writeIndex);
      const head = buffer.subarray(0, writeIndex);
      samples.set(tail, 0);
      samples.set(head, tail.length);
    }

    const sampleRate = audioCtxRef.current?.sampleRate || 48000;
    const blob = encodeWav(samples, sampleRate);
    const fileName = `${displayName}_soundbite_${Date.now()}.wav`;
    return { blob, fileName };
  }, []);

  /** Save a blob+filename — Tauri uses save dialog, web uses download link. */
  const saveSoundbite = useCallback((blob: Blob, fileName: string, skipDialog = false) => {
    if (isTauri() && !skipDialog) {
      // Tauri webview doesn't support blob URL downloads — use native save dialog
      import(/* @vite-ignore */ '@tauri-apps/plugin-dialog').then(({ save }) =>
        save({ defaultPath: fileName, filters: [{ name: 'WAV Audio', extensions: ['wav'] }] })
      ).then(async (path) => {
        if (!path) return; // user cancelled
        const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
        const arrayBuf = await blob.arrayBuffer();
        await writeFile(path, new Uint8Array(arrayBuf));
      }).catch((err) => console.error('Failed to save soundbite:', err));
    } else if (isTauri() && skipDialog) {
      // Auto-save to downloads directory without prompting
      (async () => {
        try {
          const { downloadDir, join } = await import(/* @vite-ignore */ '@tauri-apps/api/path');
          const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
          const dir = await downloadDir();
          const path = await join(dir, fileName);
          const arrayBuf = await blob.arrayBuffer();
          await writeFile(path, new Uint8Array(arrayBuf));
        } catch (err) {
          console.error('Failed to auto-save soundbite:', err);
        }
      })();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, []);

  const captureSoundbite = useCallback((identity: string, displayName: string) => {
    const result = extractSoundbite(identity, displayName);
    if (!result) return;
    saveSoundbite(result.blob, result.fileName);
  }, [extractSoundbite, saveSoundbite]);

  /** Capture all active participants at once (hotkey). Skips save dialog. */
  const captureAllSoundbites = useCallback((participants: { identity: string; displayName: string }[]) => {
    for (const { identity, displayName } of participants) {
      const result = extractSoundbite(identity, displayName);
      if (!result) continue;
      saveSoundbite(result.blob, result.fileName, true);
    }
  }, [extractSoundbite, saveSoundbite]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const recording of recordingsRef.current.values()) {
        try {
          recording.processor.disconnect();
          recording.source.disconnect();
        } catch {}
      }
      recordingsRef.current.clear();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  return { startRecording, stopRecording, captureSoundbite, captureAllSoundbites };
}
