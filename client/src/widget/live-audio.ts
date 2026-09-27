export class LivePlayback {
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  constructor(private readonly context: AudioContext, private readonly onSpeaking: (speaking: boolean) => void) {}
  get queued(): number { return this.sources.size; }
  enqueue(base64: string, sampleRate: number): void {
    if (sampleRate !== 24000 || base64.length > 512_000) throw new Error('Invalid audio response');
    const bytes = atob(base64);
    if (!bytes.length || bytes.length % 2) throw new Error('Invalid PCM response');
    if (this.nextTime - this.context.currentTime > 25) throw new Error('Audio playback fell behind');
    const buffer = this.context.createBuffer(1, bytes.length / 2, sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.connect(this.context.destination);
    source.onended = () => {
      source.disconnect(); this.sources.delete(source);
      if (!this.sources.size) this.onSpeaking(false);
    };
    this.sources.add(source);
    const start = Math.max(this.context.currentTime + 0.025, this.nextTime);
    this.nextTime = start + buffer.duration;
    source.start(start); this.onSpeaking(true);
  }
  clear(): void {
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    this.sources.clear(); this.nextTime = 0; this.onSpeaking(false);
  }
}
