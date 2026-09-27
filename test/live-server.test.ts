// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveConnectParameters, Session } from '@google/genai';
import type { WebSocket } from 'ws';
import { handleLiveSocket } from '../server/live';

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send = vi.fn(); ping = vi.fn(() => this.emit('pong'));
  close = vi.fn(() => { this.readyState = 3; this.emit('close'); });
  terminate = this.close;
  receive(value: unknown) { this.emit('message', Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), false); }
  messages() { return this.send.mock.calls.map(([s]) => JSON.parse(s)); }
}
const context = { siteId: 'ledgerly', mode: 'assist', goal: 'Setup', transcript: [], pageModel: 'URL /ledgerly/setup\n[1] input(text) "Name" value="" visible' };
let ws: Socket;
let callbacks: LiveConnectParameters['callbacks'];
let upstream: { close: ReturnType<typeof vi.fn>; sendRealtimeInput: ReturnType<typeof vi.fn>; sendClientContent: ReturnType<typeof vi.fn>; sendToolResponse: ReturnType<typeof vi.fn> };
let connector: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  ws = new Socket(); upstream = { close: vi.fn(), sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn() };
  connector = vi.fn(async (p: LiveConnectParameters) => { callbacks = p.callbacks; return upstream as unknown as Session; });
  handleLiveSocket(ws as unknown as WebSocket, connector);
});
afterEach(() => { ws.close(); vi.useRealTimers(); });
const start = async () => { ws.receive({ type: 'start', context }); await Promise.resolve(); await Promise.resolve(); };
const tool = (id = 'call1') => callbacks.onmessage!({ toolCall: { functionCalls: [{ id, name: 'pathfinder_action', args: { action: 'fill', target_id: 1, target_name: 'Name', value: 'Acme', message: 'Name', goal_id: 'workspace' } }] } } as never);

describe('Live server relay lifecycle', () => {
  it('rejects malformed messages without opening a paid session', () => {
    ws.receive('{bad'); expect(connector).not.toHaveBeenCalled();
    expect(ws.messages()[0]).toMatchObject({ type: 'error', code: 'LIVE_BAD_MESSAGE' }); expect(ws.close).toHaveBeenCalled();
  });
  it('does not resolve a blocking call until the browser confirms and returns the result', async () => {
    await start(); tool();
    expect(ws.messages().at(-1)).toMatchObject({ type: 'action', id: 'call1', action: { action: 'fill' } });
    expect(upstream.sendToolResponse).not.toHaveBeenCalled();
    ws.receive({ type: 'result', id: 'call1', outcome: 'User skipped', pageModel: context.pageModel });
    expect(upstream.sendToolResponse).toHaveBeenCalledWith({ functionResponses: [{ id: 'call1', name: 'pathfinder_action', response: { outcome: 'User skipped', pageModel: context.pageModel, mode: 'assist' } }] });
  });
  it.each([
    ['Allow', 'filled Organization name', 'URL /ledgerly/setup?step=1\n[1] input(text) "Organization name" value="Acme Roasters" visible'],
    ['Edit', 'filled edited Organization name', 'URL /ledgerly/setup?step=1\n[1] input(text) "Organization name" value="Acme Coffee" visible'],
    ['Skip', 'User skipped the action', context.pageModel],
  ])('holds the blocking %s result until confirmation and responds exactly once', async (_choice, outcome, pageModel) => {
    await start(); tool();
    expect(upstream.sendToolResponse).not.toHaveBeenCalled();
    ws.receive({ type: 'result', id: 'call1', outcome, pageModel });
    ws.receive({ type: 'result', id: 'call1', outcome: 'duplicate', pageModel });
    expect(upstream.sendToolResponse).toHaveBeenCalledOnce();
    expect(upstream.sendToolResponse).toHaveBeenCalledWith({ functionResponses: [{ id: 'call1', name: 'pathfinder_action', response: { outcome, pageModel, mode: 'assist' } }] });
  });
  it('serializes multiple tools so the second sees the first fresh snapshot', async () => {
    await start(); tool('one'); tool('two');
    expect(ws.messages().filter(m => m.type === 'action')).toHaveLength(1);
    ws.receive({ type: 'result', id: 'one', outcome: 'changed page', pageModel: 'URL /ledgerly/dashboard\nCONTENT: New page' });
    expect(ws.messages().filter(m => m.type === 'action')[1]).toMatchObject({ id: 'two', action: { policy_blocked: true } });
  });
  it('relays interruption/cancellation and ignores late tool results', async () => {
    await start(); tool();
    callbacks.onmessage!({ serverContent: { interrupted: true }, toolCallCancellation: { ids: ['call1'] } } as never);
    expect(ws.messages()).toContainEqual({ type: 'interrupted' });
    expect(ws.messages()).toContainEqual({ type: 'cancel', ids: ['call1'] });
    ws.receive({ type: 'result', id: 'call1', outcome: 'too late', pageModel: context.pageModel });
    expect(upstream.sendToolResponse).not.toHaveBeenCalled();
  });
  it('cleans up upstream and timers when the browser disconnects', async () => {
    await start(); ws.close(); expect(upstream.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    callbacks.onmessage!({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AA==' } }] } } } as never);
    expect(ws.messages().filter(m => m.type === 'audio')).toHaveLength(0);
  });
  it('drops a pending call on Stop and starts a clean replacement session', async () => {
    await start(); tool();
    ws.receive({ type: 'stop' });
    expect(upstream.close).toHaveBeenCalledOnce();
    expect(upstream.sendToolResponse).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const replacement = new Socket();
    const nextUpstream = { close: vi.fn(), sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn() };
    handleLiveSocket(replacement as unknown as WebSocket, async () => nextUpstream as unknown as Session);
    replacement.receive({ type: 'start', context });
    await Promise.resolve(); await Promise.resolve();
    expect(replacement.messages()).toContainEqual(expect.objectContaining({ type: 'ready', model: 'gemini-3.8-live' }));
    expect(nextUpstream.sendToolResponse).not.toHaveBeenCalled();
    replacement.close();
  });
  it('closes a late connection after the browser disconnects during setup', async () => {
    ws.close();
    const late = new Socket();
    let resolve!: (session: Session) => void;
    handleLiveSocket(late as unknown as WebSocket, () => new Promise(r => { resolve = r; }));
    late.receive({ type: 'start', context }); late.close(); resolve(upstream as unknown as Session);
    await Promise.resolve(); expect(upstream.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a confirmation that times out and returns a truthful outcome', async () => {
    await start(); tool(); await vi.advanceTimersByTimeAsync(120_000);
    expect(ws.messages()).toContainEqual({ type: 'cancel', ids: ['call1'] });
    expect(upstream.sendToolResponse.mock.calls[0][0].functionResponses[0].response.outcome).toContain('timed out');
    expect(ws.close).not.toHaveBeenCalled(); ws.close(); expect(vi.getTimerCount()).toBe(0);
  });
  it('never exposes raw provider exception content', async () => {
    ws.close(); const failed = new Socket();
    handleLiveSocket(failed as unknown as WebSocket, async () => { throw Object.assign(new Error('SECRET transcript and API key'), { status: 402 }); });
    failed.receive({ type: 'start', context }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(failed.messages()).toContainEqual(expect.objectContaining({ code: 'MODEL_BILLING_ERROR' }));
    expect(JSON.stringify(failed.messages())).not.toContain('SECRET'); failed.close();
  });
});
