// Runs in a 16kHz AudioContext. Web Audio resamples the hardware microphone.
// 20ms mono PCM16 little-endian frames; no client-side VAD.
class PathfinderPCM extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Float32Array(320); this.used = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.used++] = value / channels.length;
      if (this.used === 320) {
        const bytes = new ArrayBuffer(640);
        const view = new DataView(bytes);
        for (let n = 0; n < 320; n++) {
          const sample = Math.max(-1, Math.min(1, this.samples[n]));
          view.setInt16(n * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        }
        this.port.postMessage(bytes, [bytes]);
        this.used = 0;
      }
    }
    // Output stays silent; microphone is never locally monitored.
    return true;
  }
}
registerProcessor('pathfinder-pcm', PathfinderPCM);
