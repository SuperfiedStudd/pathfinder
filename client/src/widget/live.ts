import { materialPage, type LiveClientMessage, type LiveServerMessage } from '@shared/live';
import type { OnboardingLoop } from './loop';
import { LivePlayback } from './live-audio';

export type LiveStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export class LiveController {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private input: AudioContext | null = null;
  private output: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private playback: LivePlayback | null = null;
  private generation = 0;
  private ready = false;
  private status: LiveStatus = 'idle';
  private connectTimer: number | null = null;
  private pageTimer: number | null = null;
  private observer: MutationObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastPage = '';
  private lastMode = '';
  private textId = 0;
  private handledCalls = new Set<string>();

  constructor(private readonly loop: OnboardingLoop, private readonly onStatus: (status: LiveStatus) => void,
    private readonly onError: (message: string) => void) {}
  get active(): boolean { return this.status === 'connecting' || this.ready; }
  getStatus(): LiveStatus { return this.status; }
  private setStatus(status: LiveStatus): void { this.status = status; this.onStatus(status); }
  private send(message: LiveClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
  private fail(message: string): void { this.stop(); this.onError(message); this.setStatus('error'); }

  async start(): Promise<void> {
    if (this.active) return;
    this.onError('');
    if (!this.loop.beginLive(text => this.sendText(text))) { this.onError('Finish the current action before starting voice.'); return; }
    const generation = ++this.generation;
    this.setStatus('connecting');
    this.connectTimer = window.setTimeout(() => this.fail('Voice did not connect. Check microphone permission and try again.'), 30_000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new Error('Voice requires microphone access and AudioWorklet support. You can use text or the fallback mic.');
      this.input = new AudioContext({ sampleRate: 16000 });
      this.output = new AudioContext({ sampleRate: 24000 });
      // Resume on the user gesture before awaiting microphone permission.
      const resumes = Promise.all([this.input.resume(), this.output.resume()]);
      await resumes;
      if (generation !== this.generation) return;
      if (this.input.sampleRate !== 16000) throw new Error('This browser cannot capture 16 kHz audio. Use the fallback mic.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getTracks()) track.onended = () => this.fail('Microphone disconnected. Start voice again or use text.');
      await this.input.audioWorklet.addModule('/live-pcm-worklet.js');
      if (generation !== this.generation) return;
      this.source = this.input.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(this.input, 'pathfinder-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.worklet.onprocessorerror = () => this.fail('Microphone processing stopped. Reconnect or use the fallback mic.');
      this.worklet.port.onmessage = event => {
        if (!this.ready || generation !== this.generation || this.ws?.readyState !== WebSocket.OPEN) return;
        if (this.ws.bufferedAmount > 128_000) { this.fail('Voice connection is too slow. Reconnect or use text.'); return; }
        this.ws.send(event.data as ArrayBuffer);
      };
      this.source.connect(this.worklet);
      this.worklet.connect(this.input.destination); // worklet emits silence
      this.playback = new LivePlayback(this.output, speaking => {
        if (this.ready) this.setStatus(speaking ? 'speaking' : 'listening');
      });
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
      this.ws = ws;
      ws.onopen = () => {
        if (generation !== this.generation) return;
        const context = this.loop.liveContext();
        this.lastPage = materialPage(context.pageModel); this.lastMode = context.mode;
        this.send({ type: 'start', context });
      };
      ws.onmessage = event => {
        if (generation !== this.generation) return;
        try { this.receive(JSON.parse(event.data as string) as LiveServerMessage, generation); }
        catch { this.fail('Voice response could not be read. Reconnect or continue with text.'); }
      };
      ws.onerror = () => { if (generation === this.generation) this.fail('Voice connection failed. Start voice again or use text.'); };
      ws.onclose = () => { if (generation === this.generation) this.fail('Voice disconnected. Start voice again or continue with text.'); };
    } catch (error) {
      if (generation !== this.generation) return;
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.fail(denied ? 'Microphone permission was denied. You can still type or retry voice.' : error instanceof Error ? error.message : 'Voice could not start.');
    }
  }

  private receive(message: LiveServerMessage, generation: number): void {
    if (!message || typeof message !== 'object') throw new Error('Invalid message');
    switch (message.type) {
      case 'ready':
        if (this.ready) return;
        this.ready = true;
        if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
        this.connectTimer = null; this.loop.liveReady(); this.setStatus('listening'); this.watchPage(); this.publishPage();
        return;
      case 'audio': this.playback?.enqueue(message.data, message.sampleRate); return;
      case 'transcript':
        if (typeof message.id !== 'string' || typeof message.text !== 'string' || !['user', 'agent'].includes(message.role)) throw new Error('Invalid transcript');
        this.loop.liveTranscript(message.id, message.role, message.text); return;
      case 'interrupted': this.playback?.clear(); if (this.ready) this.setStatus('listening'); return;
      case 'turn_complete': if (this.ready && !this.playback?.queued) this.setStatus('listening'); return;
      case 'cancel':
        if (!Array.isArray(message.ids)) throw new Error('Invalid cancellation');
        for (const id of message.ids) { this.handledCalls.add(id); this.loop.cancelLiveAction(id); }
        return;
      case 'action':
        if (!this.ready || typeof message.id !== 'string' || !message.action || this.handledCalls.has(message.id)) return;
        this.handledCalls.add(message.id);
        void this.loop.runLiveAction(message.id, message.action).then(result => {
          if (generation !== this.generation) return;
          this.lastPage = materialPage(result.pageModel);
          this.send({ type: 'result', id: message.id, ...result });
        }).catch(() => {
          if (generation !== this.generation) return;
          this.send({ type: 'result', id: message.id, outcome: 'Browser action failed; do not claim success.', pageModel: this.loop.liveContext().pageModel });
        });
        return;
      case 'error': this.fail(`${message.message} (${message.code})`); return;
      default: throw new Error('Unknown voice event');
    }
  }

  sendText(text: string): void {
    if (!this.ready) { this.onError('Voice is still connecting. Send your message once Listening appears.'); return; }
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;
    this.playback?.clear();
    this.loop.liveTranscript(`typed:${this.generation}:${++this.textId}`, 'user', trimmed);
    this.publishPage(); this.send({ type: 'text', text: trimmed });
  }

  private schedulePage = (): void => {
    if (!this.ready || this.pageTimer !== null) return;
    this.pageTimer = window.setTimeout(() => { this.pageTimer = null; this.publishPage(); }, 700);
  };
  private publishPage(): void {
    if (!this.ready) return;
    const context = this.loop.liveContext();
    const material = materialPage(context.pageModel);
    if (material === this.lastPage && context.mode === this.lastMode) return;
    this.lastPage = material; this.lastMode = context.mode;
    this.send({ type: 'page', pageModel: context.pageModel, mode: context.mode, goal: context.goal });
  }
  private watchPage(): void {
    this.observer = new MutationObserver(records => {
      if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-pf-widget]'))) this.schedulePage();
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-checked', 'aria-selected', 'hidden', 'value', 'checked'] });
    for (const event of ['input', 'change', 'scroll', 'resize', 'popstate', 'pf:navigate']) window.addEventListener(event, this.schedulePage, true);
    this.unsubscribe = this.loop.subscribe(view => { if (view.mode !== this.lastMode) this.publishPage(); });
  }

  stop(): void {
    ++this.generation; this.ready = false;
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    if (this.pageTimer !== null) window.clearTimeout(this.pageTimer);
    this.connectTimer = this.pageTimer = null;
    this.observer?.disconnect(); this.observer = null; this.unsubscribe?.(); this.unsubscribe = null;
    for (const event of ['input', 'change', 'scroll', 'resize', 'popstate', 'pf:navigate']) window.removeEventListener(event, this.schedulePage, true);
    this.playback?.clear(); this.playback = null;
    if (this.worklet) { this.worklet.port.onmessage = null; this.worklet.onprocessorerror = null; this.worklet.port.close(); this.worklet.disconnect(); }
    this.worklet = null; this.source?.disconnect(); this.source = null;
    for (const track of this.stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    this.stream = null;
    if (this.input) void this.input.close().catch(() => {});
    if (this.output) void this.output.close().catch(() => {});
    this.input = this.output = null;
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      this.send({ type: 'stop' }); this.ws.close();
    }
    this.ws = null; this.handledCalls.clear(); this.lastPage = this.lastMode = '';
    this.loop.endLive(); this.setStatus('idle');
  }
  dispose(): void { this.stop(); }
}
