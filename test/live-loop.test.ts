import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingLoop } from '../client/src/widget/loop';
import { manifests } from '../shared/manifests';
import type { Overlay } from '../client/src/widget/overlay';
import { snapshot, resetSnapshotMemory } from '../client/src/widget/extract';
import { normalizeLiveTool } from '../shared/live';

let loop: OnboardingLoop;
let input: HTMLInputElement;
let id: number;
beforeEach(() => {
  vi.useFakeTimers(); resetSnapshotMemory();
  document.body.innerHTML = '<main><label for="org">Organization name</label><input id="org"><button>Continue</button></main><div data-pf-widget></div>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent || ''; } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const overlay = { clear: vi.fn(), show: vi.fn(), current: () => null, destroy: vi.fn() } as unknown as Overlay;
  loop = new OnboardingLoop('ledgerly', manifests.ledgerly, overlay, document.querySelector('[data-pf-widget]')!);
  loop.setMode('assist'); loop.beginLive(vi.fn());
  snapshot(); input = document.getElementById('org') as HTMLInputElement; id = Number(input.dataset.pfId);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { loop.destroy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const fill = (value = 'Acme Roasters') => normalizeLiveTool({ action: 'fill', target_id: id, target_name: 'Organization name', value, message: 'Fill this field.', goal_id: 'workspace' });
const click = (targetId: number, targetName = 'Continue') => normalizeLiveTool({ action: 'click', target_id: targetId, target_name: targetName, message: 'Continue setup.', goal_id: 'workspace' });

describe('Live reuses browser policy, executor and confirmations', () => {
  it('waits for Allow before mutating and sends no Flash request', async () => {
    const pending = loop.runLiveAction('a', fill());
    expect(loop.getView().state).toBe('awaiting_confirm'); expect(input.value).toBe('');
    loop.confirm('allow'); await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.outcome).toContain('filled'); expect(input.value).toBe('Acme Roasters');
    expect(result.pageModel).toContain('value="Acme Roasters"');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses edited values and existing execution', async () => {
    const pending = loop.runLiveAction('a', fill()); loop.confirm('edit', 'Acme Coffee'); await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.pageModel).toContain('value="Acme Coffee"'); expect(result.pageModel).not.toContain('value="Acme Roasters"');
    expect(input.value).toBe('Acme Coffee');
  });
  it('resolves Skip without mutating', async () => {
    const pending = loop.runLiveAction('a', fill()); loop.confirm('skip');
    const result = await pending;
    expect(result.outcome).toContain('skipped'); expect(result.pageModel).toContain('value=""'); expect(input.value).toBe('');
  });
  it('rechecks mode after confirmation', async () => {
    const pending = loop.runLiveAction('a', fill()); loop.setMode('guide'); loop.confirm('allow');
    expect((await pending).outcome).toContain('policy blocked'); expect(input.value).toBe('');
  });
  it('uses allow-all for fill and navigation click while returning the new Ledgerly step', async () => {
    loop.setAllowAll(true);
    const filled = loop.runLiveAction('fill', fill());
    expect(loop.getView().pendingConfirm).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect((await filled).pageModel).toContain('value="Acme Roasters"');

    const button = document.querySelector('main button') as HTMLButtonElement;
    button.addEventListener('click', () => {
      document.querySelector('main')!.innerHTML = '<h1>Choose a pipeline</h1><p>Step 2 of 5</p>';
      history.pushState({}, '', '/ledgerly/setup?step=2');
    });
    snapshot();
    const buttonId = Number(button.dataset.pfId);
    const navigated = loop.runLiveAction('click', click(buttonId));
    expect(loop.getView().pendingConfirm).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    const result = await navigated;
    expect(result.outcome).toContain('clicked');
    expect(result.pageModel).toContain('URL /ledgerly/setup?step=2');
    expect(result.pageModel).toContain('Choose a pipeline');
    expect(document.querySelector('main button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks both fill and click in Guide even when allow-all was set in Assist', async () => {
    loop.setAllowAll(true); loop.setMode('guide');
    const buttonId = Number((document.querySelector('main button') as HTMLButtonElement).dataset.pfId);
    const clicked = vi.fn(); document.querySelector('main button')!.addEventListener('click', clicked);
    const filled = await loop.runLiveAction('fill', fill());
    const navigated = await loop.runLiveAction('click', click(buttonId));
    expect(filled.outcome).toContain('policy blocked');
    expect(navigated.outcome).toContain('policy blocked');
    expect(input.value).toBe(''); expect(clicked).not.toHaveBeenCalled();
  });
  it('cancels pending confirmations on disconnect and restores text routing', async () => {
    const pending = loop.runLiveAction('a', fill()); loop.endLive();
    expect((await pending).outcome).toContain('cancelled'); expect(input.value).toBe('');
    expect(loop.getView()).toMatchObject({ state: 'idle', pendingConfirm: null });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    loop.send('Continue with text'); await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('blocks sensitive fields even with allow-all set', async () => {
    input.setAttribute('autocomplete', 'cc-number'); loop.setAllowAll(true);
    const result = await loop.runLiveAction('a', fill());
    expect(result.outcome).toContain('sensitive'); expect(input.value).toBe(''); expect(loop.getView().pendingConfirm).toBeNull();
  });
  it('blocks sensitive clicks even with allow-all set', async () => {
    const button = document.querySelector('main button') as HTMLButtonElement;
    button.setAttribute('data-pf-sensitive', ''); loop.setAllowAll(true);
    const clicked = vi.fn(); button.addEventListener('click', clicked);
    const result = await loop.runLiveAction('click', click(Number(button.dataset.pfId)));
    expect(result.outcome).toContain('sensitive'); expect(clicked).not.toHaveBeenCalled();
  });
  it('uses accessible-name fallback after target replacement', async () => {
    loop.setAllowAll(true);
    const button = document.querySelector('main button')!;
    const action = normalizeLiveTool({ action: 'click', target_id: Number(button.getAttribute('data-pf-id')), target_name: 'Continue', message: 'Continue', goal_id: 'workspace' });
    const replacement = button.cloneNode(true) as HTMLButtonElement; replacement.removeAttribute('data-pf-id'); button.replaceWith(replacement);
    const clicked = vi.fn(); replacement.addEventListener('click', clicked);
    const pending = loop.runLiveAction('a', action); await vi.advanceTimersByTimeAsync(600);
    expect((await pending).outcome).toContain('resolved by name'); expect(clicked).toHaveBeenCalledOnce();
  });
  it('rejects an ambiguous stale-name fallback without clicking either target', async () => {
    loop.setAllowAll(true);
    const button = document.querySelector('main button') as HTMLButtonElement;
    const oldId = Number(button.dataset.pfId);
    const clicked = vi.fn();
    const main = document.querySelector('main')!;
    main.innerHTML = '<button>Continue</button><button>Continue</button>';
    main.querySelectorAll('button').forEach(b => b.addEventListener('click', clicked));
    const result = await loop.runLiveAction('click', click(oldId));
    expect(result.outcome).toContain('policy blocked');
    expect(clicked).not.toHaveBeenCalled();
  });
  it('gates done until the Ledgerly workspace-ready marker is visible', async () => {
    const done = normalizeLiveTool({ action: 'done', message: 'Workspace is ready.', goal_id: 'workspace' });
    const premature = await loop.runLiveAction('early', done);
    expect(premature.outcome).toContain('policy blocked');
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p>Workspace ready</p>');
    const complete = await loop.runLiveAction('complete', done);
    expect(complete.outcome).toBe('goal complete');
    expect(complete.pageModel).toContain('Workspace ready');
  });
  it('updates one chat bubble per transcript id without invoking Flash', () => {
    loop.liveTranscript('user1', 'user', 'Hello'); loop.liveTranscript('user1', 'user', 'Hello world');
    loop.liveTranscript('agent1', 'agent', 'Hi'); loop.liveTranscript('agent1', 'agent', 'Hi');
    expect(loop.getView().messages.filter(m => m.live)).toHaveLength(2);
    expect(loop.getView().messages.find(m => m.role === 'user')?.text).toBe('Hello world');
    expect(fetch).not.toHaveBeenCalled();
  });
});
