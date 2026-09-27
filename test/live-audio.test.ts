import { describe, expect, it, vi } from 'vitest';
import { LivePlayback } from '../client/src/widget/live-audio';

function player() {
  const sources: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; onended: (() => void) | null; buffer: unknown }> = [];
  const context = {
    currentTime: 2, destination: {},
    createBuffer: (_channels: number, count: number, rate: number) => ({ duration: count / rate, getChannelData: () => new Float32Array(count) }),
    createBufferSource: () => { const source = { stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), start: vi.fn(), onended: null, buffer: null }; sources.push(source); return source; },
  };
  const speaking = vi.fn();
  return { playback: new LivePlayback(context as unknown as AudioContext, speaking), speaking, sources };
}

describe('incremental Live audio queue', () => {
  it('schedules audio immediately and empties both current and future sources on interruption', () => {
    const { playback, sources, speaking } = player();
    playback.enqueue('AAAAAA==', 24000); playback.enqueue('AAAAAA==', 24000);
    expect(playback.queued).toBe(2); expect(sources[0].start).toHaveBeenCalledOnce();
    expect(sources[1].start.mock.calls[0][0]).toBeGreaterThan(sources[0].start.mock.calls[0][0]);
    playback.clear();
    expect(playback.queued).toBe(0); expect(speaking).toHaveBeenLastCalledWith(false);
    for (const source of sources) { expect(source.stop).toHaveBeenCalledOnce(); expect(source.disconnect).toHaveBeenCalledOnce(); expect(source.onended).toBeNull(); }
    playback.clear(); expect(sources[0].stop).toHaveBeenCalledOnce();
  });
  it('can play the next response after interruption without replaying discarded chunks', () => {
    const { playback, sources } = player();
    playback.enqueue('AAAAAA==', 24000); playback.clear(); playback.enqueue('AAAAAA==', 24000);
    expect(playback.queued).toBe(1); expect(sources).toHaveLength(2);
    sources[1].onended?.(); expect(playback.queued).toBe(0);
  });
  it('rejects malformed PCM or an unexpected output rate', () => {
    const { playback } = player();
    expect(() => playback.enqueue('AA==', 24000)).toThrow();
    expect(() => playback.enqueue('AAAA', 16000)).toThrow();
  });
});
