import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pathfinder } from '../client/src/sdk';

const manifest = {
  siteId: 'sdk-demo', siteName: 'SDK host example', about: 'test',
  goals: [{ id: 'workspace', title: 'Finish setup', doneWhen: 'Workspace ready' }],
  clarify: [], policy: { defaultMode: 'guide', allowAssist: true },
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('public SDK lifecycle', () => {
  it('exposes version, reuses duplicate init, destroys and remounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
    expect(Pathfinder.version).toMatch(/^\d+\.\d+\.\d+$/);
    const first = Pathfinder.init({ siteId: 'sdk-demo', apiBaseUrl: 'http://localhost:8788' });
    expect(Pathfinder.init({ siteId: 'sdk-demo', apiBaseUrl: 'http://localhost:8788' })).toBe(first);
    await settle();
    expect(document.querySelectorAll('[data-pf-widget]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pf-styles]')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    first.destroy();
    first.destroy();
    expect(document.querySelectorAll('[data-pf-widget]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-pf-styles]')).toHaveLength(0);
    const second = Pathfinder.init({ siteId: 'sdk-demo', apiBaseUrl: 'http://localhost:8788' });
    expect(second).not.toBe(first);
    await settle();
    expect(document.querySelectorAll('[data-pf-widget]')).toHaveLength(1);
    second.destroy();
  });
  it('does not mount after destroy during a pending manifest fetch', async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
    const instance = Pathfinder.init({ siteId: 'sdk-demo' });
    instance.destroy();
    resolve({ ok: true, json: async () => manifest });
    await settle();
    expect(document.querySelector('[data-pf-widget]')).toBeNull();
  });
});
