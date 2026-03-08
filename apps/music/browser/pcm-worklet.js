// AudioWorklet processor — runs on a dedicated audio thread (no main-thread jitter)
// Receives interleaved Float32 PCM chunks via MessagePort from the main thread.

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const RING_CAPACITY = SAMPLE_RATE * CHANNELS * 2; // 2s stereo

class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_CAPACITY);
    this.ringWrite = 0;
    this.ringRead = 0;
    this.ringCount = 0;
    this.underruns = 0;
    this.frames = 0;

    this.port.onmessage = (e) => {
      const samples = e.data; // Float32Array, interleaved [L, R, L, R, ...]
      const count = samples.length;

      // Drop if ring buffer >90% full (prevent stale buildup)
      if (this.ringCount + count > RING_CAPACITY * 0.9) return;

      for (let i = 0; i < count; i++) {
        this.ring[this.ringWrite] = samples[i];
        this.ringWrite = (this.ringWrite + 1) % RING_CAPACITY;
      }
      this.ringCount += count;
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const outL = output[0];
    const outR = output[1];
    const len = outL.length; // 128 samples per render quantum

    this.frames++;

    for (let i = 0; i < len; i++) {
      if (this.ringCount >= 2) {
        outL[i] = this.ring[this.ringRead];
        this.ringRead = (this.ringRead + 1) % RING_CAPACITY;
        outR[i] = this.ring[this.ringRead];
        this.ringRead = (this.ringRead + 1) % RING_CAPACITY;
        this.ringCount -= 2;
      } else {
        outL[i] = 0;
        outR[i] = 0;
        this.underruns++;
      }
    }

    // Report stats every ~5s (48000/128 = 375 calls/s → 1875 calls)
    if (this.frames % 1875 === 0) {
      const fillMs = ((this.ringCount / CHANNELS) / SAMPLE_RATE * 1000) | 0;
      this.port.postMessage({
        type: 'stats',
        fillMs,
        underruns: this.underruns,
        frames: this.frames,
      });
      this.underruns = 0;
      this.frames = 0;
    }

    return true;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
