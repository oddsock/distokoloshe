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
    this.peakL = 0;
    this.peakR = 0;
    this.clipCount = 0; // samples >= 0.99

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
        const l = this.ring[this.ringRead];
        this.ringRead = (this.ringRead + 1) % RING_CAPACITY;
        const r = this.ring[this.ringRead];
        this.ringRead = (this.ringRead + 1) % RING_CAPACITY;
        this.ringCount -= 2;
        outL[i] = l;
        outR[i] = r;

        // Peak tracking
        const absL = l < 0 ? -l : l;
        const absR = r < 0 ? -r : r;
        if (absL > this.peakL) this.peakL = absL;
        if (absR > this.peakR) this.peakR = absR;
        if (absL >= 0.99 || absR >= 0.99) this.clipCount++;
      } else {
        outL[i] = 0;
        outR[i] = 0;
        this.underruns++;
      }
    }

    // Report stats every ~5s (48000/128 = 375 calls/s → 1875 calls)
    if (this.frames % 1875 === 0) {
      const fillMs = ((this.ringCount / CHANNELS) / SAMPLE_RATE * 1000) | 0;
      // Convert peak to dBFS
      const peakDb = this.peakL > 0 ? (20 * Math.log10(this.peakL)).toFixed(1) : '-inf';
      this.port.postMessage({
        type: 'stats',
        fillMs,
        underruns: this.underruns,
        frames: this.frames,
        peakL: this.peakL.toFixed(4),
        peakR: this.peakR.toFixed(4),
        peakDb,
        clipCount: this.clipCount,
      });
      this.underruns = 0;
      this.frames = 0;
      this.peakL = 0;
      this.peakR = 0;
      this.clipCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
