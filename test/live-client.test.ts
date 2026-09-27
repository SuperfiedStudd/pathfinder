import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveController } from '../client/src/widget/live';
import type { OnboardingLoop } from '../client/src/widget/loop';
import { createTransport } from '../client/src/sdk/transport';

class Context {
  static instances: Context[] = [];
  sampleRate: number;
  destination = {};
  currentTime = 0;
  sources: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  createBuffer = (_channels: number, size: number, rate: number) => ({ duration: size / rate, getChannelData: () => new Float32Array(size) });
  createBufferSource = () => {
    const source = { stop: vi.fn(), disconnect: vi.fn(), start: vi.fn(), connect: vi.fn(), onended: null, buffer: null };
    this.sources.push(source); return source;
  };
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; Context.instances.push(this); }
}
class Worklet {
  static instance: Worklet;
  port = { onmessage: null, close: vi.fn() };
  onprocessorerror = null;
  connect = vi.fn(); disconnect = vi.fn();
  constructor() { Worklet.instance = this; }
}
class Socket {
  static OPEN = 1;
  static instance: Socket;
  readyState = 1; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instance = this; }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
let controller: LiveController;
let status: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;
let endLive: ReturnType<typeof vi.fn>;
let track: { stop: ReturnType<typeof vi.fn>; onended: null };
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); Context.instances = [];
  vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Worklet); vi.stubGlobal('WebSocket', Socket);
  track = { stop: vi.fn(), onended: null }; getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  status = vi.fn(); error = vi.fn(); endLive = vi.fn();
  const loop = { siteId: 'canopy', transport: createTransport('http://localhost:8788'), beginLive: () => true, endLive, liveReady: vi.fn(), liveContext: () => ({ siteId: 'canopy', mode: 'guide', goal: '', transcript: [], pageModel: 'URL /canopy\nCONTENT: Trees' }), subscribe: () => vi.fn() };
  controller = new LiveController(loop as unknown as OnboardingLoop, status, error);
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Live browser lifecycle', () => {
  it('releases tracks, worklet, contexts, websocket and timers on disconnect', async () => {
    await controller.start(); const ws = Socket.instance; ws.onopen?.(); ws.receive({ type: 'ready', model: 'gemini-3.8-live', sessionId: 'a' });
    expect(controller.getStatus()).toBe('listening'); ws.onclose?.();
    expect(controller.getStatus()).toBe('error'); expect(controller.active).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce(); expect(Worklet.instance.disconnect).toHaveBeenCalledOnce(); expect(Worklet.instance.port.close).toHaveBeenCalledOnce();
    for (const context of Context.instances) expect(context.close).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledOnce(); expect(endLive).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(ws.onmessage).toBeNull();
  });
  it('stops a microphone that arrives after the user cancels permission setup', async () => {
    let resolve!: (value: { getTracks: () => typeof track[] }) => void;
    getUserMedia.mockReturnValue(new Promise(r => { resolve = r; }));
    const pending = controller.start(); await vi.advanceTimersByTimeAsync(0);
    controller.stop(); resolve({ getTracks: () => [track] }); await pending;
    expect(track.stop).toHaveBeenCalledOnce(); expect(controller.active).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('isolates permission denial from text mode and supports a new explicit attempt', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await controller.start(); expect(endLive).toHaveBeenCalledOnce(); expect(controller.getStatus()).toBe('error');
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('permission'));
    await controller.start(); expect(controller.getStatus()).toBe('connecting'); expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
  it('cleans up safely on malformed server events', async () => {
    await controller.start(); Socket.instance.receive(null);
    expect(controller.getStatus()).toBe('error'); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('handles a server interruption by stopping audio while leaving microphone and socket active', async () => {
    await controller.start(); const ws = Socket.instance; ws.onopen?.(); ws.receive({ type: 'ready', model: 'gemini-3.8-live', sessionId: 'a' });
    ws.receive({ type: 'audio', data: 'AAAAAA==', sampleRate: 24000 });
    ws.receive({ type: 'audio', data: 'AAAAAA==', sampleRate: 24000 });
    expect(controller.getStatus()).toBe('speaking');
    ws.receive({ type: 'interrupted' });
    expect(controller.getStatus()).toBe('listening'); expect(controller.active).toBe(true);
    expect(track.stop).not.toHaveBeenCalled(); expect(ws.close).not.toHaveBeenCalled();
    for (const source of Context.instances[1].sources) expect(source.stop).toHaveBeenCalledOnce();
  });
});
