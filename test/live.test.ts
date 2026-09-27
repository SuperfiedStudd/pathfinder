import { describe, expect, it } from 'vitest';
import { LIVE_MODEL, LiveTranscripts, materialPage, normalizeLiveTool, parseLiveClientMessage, validateLiveAction } from '../shared/live';
import { manifests } from '../shared/manifests';
import { LIVE_TOOL, liveConfig } from '../server/live';

const page = 'URL /ledgerly/setup\n[10] input(text) "Organization name" value="" visible\n[11] button "Continue" disabled visible';
const args = { action: 'fill', target_id: 10, target_name: 'Organization name', value: 'Acme', message: 'Enter your organization.', goal_id: 'workspace' };
const context = { siteId: 'ledgerly', mode: 'guide' as const, goal: 'Setup', pageModel: page, transcript: [] };

describe('Live tools and session contract', () => {
  it('uses the exact current model, AUDIO, transcription, automatic VAD and blocking tools without thinking settings', () => {
    expect(LIVE_MODEL).toBe('gemini-3.8-live');
    const config = liveConfig(context);
    expect(config.responseModalities).toEqual(['AUDIO']);
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.outputAudioTranscription).toEqual({});
    expect(config.realtimeInputConfig?.automaticActivityDetection).toEqual({ disabled: false });
    expect(config).not.toHaveProperty('thinkingConfig');
    expect(config).not.toHaveProperty('generationConfig');
    expect(LIVE_TOOL.behavior).toBe('BLOCKING');
  });
  it('normalizes a tool into the existing Action shape', () => {
    expect(normalizeLiveTool(args)).toEqual({ ...args, thought: '' });
  });
  it.each([null, [], { ...args, selector: '#anything' }, { ...args, action: 'eval' }, { ...args, target_id: -1 }, { ...args, target_id: 1.5 }, { ...args, target_name: '' }, { ...args, value: {} }, { ...args, message: '' }])('rejects malformed tools %#', input => {
    expect(() => normalizeLiveTool(input)).toThrow();
  });
  it('blocks mutations in guide mode and when the site does not permit assist', () => {
    expect(validateLiveAction(normalizeLiveTool(args), 'guide', manifests.ledgerly, page)).toMatchObject({ action: 'explain', policy_blocked: true });
    expect(validateLiveAction(normalizeLiveTool({ ...args, goal_id: 'donate' }), 'assist', manifests.canopy, page).policy_blocked).toBe(true);
  });
  it('preserves a server policy block on browser revalidation', () => {
    const blocked = validateLiveAction(normalizeLiveTool(args), 'guide', manifests.ledgerly, page);
    expect(validateLiveAction(blocked, 'assist', manifests.ledgerly, page).policy_blocked).toBe(true);
  });
  it('rejects invalid, renamed, ambiguous or disabled targets', () => {
    for (const raw of [
      { ...args, target_id: 999, target_name: 'Missing' },
      { ...args, target_name: 'Different element' },
      { ...args, action: 'click', target_id: 11, target_name: 'Continue' },
    ]) expect(validateLiveAction(normalizeLiveTool(raw), 'assist', manifests.ledgerly, page).policy_blocked).toBe(true);
    expect(validateLiveAction(normalizeLiveTool({ ...args, target_id: 999 }), 'assist', manifests.ledgerly, page + '\n[12] input(text) "Organization name" visible').policy_blocked).toBe(true);
  });
  it('preserves unique accessible-name fallback for a disappeared id', () => {
    const result = validateLiveAction(normalizeLiveTool({ ...args, target_id: 999 }), 'assist', manifests.ledgerly, page);
    expect(result).toMatchObject({ action: 'fill', target_id: 999, target_name: 'Organization name' });
  });
  it('keeps the existing completion gate', () => {
    const done = normalizeLiveTool({ action: 'done', message: 'All done', goal_id: 'workspace' });
    expect(validateLiveAction(done, 'guide', manifests.ledgerly, page)).toMatchObject({ action: 'explain', policy_blocked: true });
    expect(validateLiveAction(done, 'guide', manifests.ledgerly, page + '\nWorkspace ready').action).toBe('done');
  });
});

describe('Live wire input and transcripts', () => {
  it('validates a session context and clamps disallowed assist mode', () => {
    expect(parseLiveClientMessage(JSON.stringify({ type: 'start', context }))).toEqual({ type: 'start', context });
    const result = parseLiveClientMessage(JSON.stringify({ type: 'start', context: { ...context, siteId: 'canopy', mode: 'assist' } }));
    expect(result?.type === 'start' && result.context.mode).toBe('guide');
  });
  it.each(['broken', 'null', '[]', '{"type":"eval"}', '{"type":"text","text":123}', JSON.stringify({ type: 'start', context: { ...context, siteId: '__proto__' } }), JSON.stringify({ type: 'page', mode: 'assist', goal: '', pageModel: 'URL ' + 'x'.repeat(12000) })])('rejects malformed messages %#', text => {
    expect(parseLiveClientMessage(text)).toBeNull();
  });
  it('accumulates partial/cumulative transcripts under one stable id', () => {
    const t = new LiveTranscripts('session');
    const first = t.add('user', 'Hello');
    expect(t.add('user', 'Hello')).toEqual(first);
    expect(t.add('user', ' world')).toMatchObject({ id: first!.id, text: 'Hello world' });
    expect(t.add('user', 'Hello world!')).toMatchObject({ id: first!.id, text: 'Hello world!' });
    expect(t.add('agent', 'Hi')!.id).not.toBe(first!.id);
    t.finish();
    expect(t.add('user', 'Hello')!.id).not.toBe(first!.id);
  });
  it('does not treat snapshot change summaries as material changes', () => {
    expect(materialPage(page + '\nCHANGES SINCE LAST STEP: none')).toBe(materialPage(page + '\nCHANGES SINCE LAST STEP: +[10]'));
  });
  it('deduplicates the final transcript and starts a new id for a subsequent utterance', () => {
    const t = new LiveTranscripts('s');
    const partial = t.add('user', 'Hello');
    const final = t.add('user', 'Hello there', true);
    expect(final!.id).toBe(partial!.id);
    expect(t.add('user', 'Hello there', true)).toEqual(final);
    expect(t.add('user', 'Next question')!.id).not.toBe(final!.id);
  });
});
