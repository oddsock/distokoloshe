import { useRef, useCallback, useEffect } from 'react';
import { Track } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';

const BUFFER_SECONDS = 10;
const PROCESSOR_BUFFER_SIZE = 4096;
const MUSIC_BOT_IDENTITY = '__music-bot__';

interface ParticipantRecording {
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  buffer: Float32Array;
  writeIndex: number;
  samplesFilled: number;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // subchunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Convert Float32 to Int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function useSoundbiteRecorder() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordingsRef = useRef<Map<string, ParticipantRecording>>(new Map());

  const startRecording = useCallback((identity: string, publication: RemoteTrackPublication) => {
    if (publication.source !== Track.Source.Microphone) return;
    if (identity === MUSIC_BOT_IDENTITY) return;
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

  const captureSoundbite = useCallback((identity: string, displayName: string) => {
    const recording = recordingsRef.current.get(identity);
    if (!recording || recording.samplesFilled === 0) return;

    const { buffer, writeIndex, samplesFilled } = recording;
    const samples = new Float32Array(samplesFilled);

    if (samplesFilled < buffer.length) {
      // Buffer not yet full — data is contiguous from 0
      samples.set(buffer.subarray(0, samplesFilled));
    } else {
      // Buffer is full — oldest data starts at writeIndex
      const tail = buffer.subarray(writeIndex);
      const head = buffer.subarray(0, writeIndex);
      samples.set(tail, 0);
      samples.set(head, tail.length);
    }

    const sampleRate = audioCtxRef.current?.sampleRate || 48000;
    const blob = encodeWav(samples, sampleRate);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${displayName}_soundbite_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

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

  return { startRecording, stopRecording, captureSoundbite };
}
