import { MAX_PAGE_MODEL_CHARS, type Action, type Mode, type TranscriptTurn } from './schema';
import { effectiveMode, isMode, validateAction } from './policy';
import { getManifest, manifests, type SiteManifest } from './manifests';

export const LIVE_MODEL = 'gemini-3.8-live';
export const LIVE_ACTIONS = ['highlight', 'scroll', 'fill', 'click', 'done'] as const;
export interface LiveContext { siteId: string; mode: Mode; goal: string; pageModel: string; transcript: TranscriptTurn[] }
export type LiveClientMessage =
  | { type: 'start'; context: LiveContext }
  | { type: 'page'; pageModel: string; mode: Mode; goal: string }
  | { type: 'text'; text: string }
  | { type: 'result'; id: string; outcome: string; pageModel: string }
  | { type: 'stop' };
export type LiveServerMessage =
  | { type: 'ready'; sessionId: string; model: string }
  | { type: 'audio'; data: string; sampleRate: number }
  | { type: 'transcript'; id: string; role: 'user' | 'agent'; text: string }
  | { type: 'interrupted' | 'turn_complete' }
  | { type: 'action'; id: string; action: Action }
  | { type: 'cancel'; ids: string[] }
  | { type: 'error'; code: string; message: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const page = (v: unknown): v is string => str(v, MAX_PAGE_MODEL_CHARS) && v.startsWith('URL ');
export function parseLiveClientMessage(text: string): LiveClientMessage | null {
  if (text.length > 64 * 1024) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!record(v)) return null;
  if (v.type === 'stop') return { type: 'stop' };
  if (v.type === 'text' && str(v.text, 2000) && v.text.trim()) return { type: 'text', text: v.text.trim() };
  if (v.type === 'page' && page(v.pageModel) && isMode(v.mode) && str(v.goal, 500)) {
    return { type: 'page', pageModel: v.pageModel, mode: v.mode, goal: v.goal };
  }
  if (v.type === 'result' && str(v.id, 200) && v.id && str(v.outcome, 2000) && page(v.pageModel)) {
    return { type: 'result', id: v.id, outcome: v.outcome, pageModel: v.pageModel };
  }
  const c = v.context;
  if (v.type !== 'start' || !record(c) || !str(c.siteId, 50) || !Object.prototype.hasOwnProperty.call(manifests, c.siteId) ||
      !isMode(c.mode) || !str(c.goal, 500) || !page(c.pageModel) || !Array.isArray(c.transcript) || c.transcript.length > 10 ||
      !c.transcript.every(t => record(t) && (t.role === 'user' || t.role === 'agent') && str(t.text, 2000))) return null;
  return { type: 'start', context: { siteId: c.siteId, mode: effectiveMode(c.mode, getManifest(c.siteId)!), goal: c.goal, pageModel: c.pageModel, transcript: c.transcript as TranscriptTurn[] } };
}

export function normalizeLiveTool(args: unknown): Action {
  if (!record(args) || !LIVE_ACTIONS.includes(args.action as typeof LIVE_ACTIONS[number]) ||
      !str(args.message, 1000) || !args.message.trim() || !str(args.goal_id, 80) || !args.goal_id ||
      Object.keys(args).some(k => !['action', 'target_id', 'target_name', 'value', 'message', 'goal_id'].includes(k)) ||
      (args.target_id != null && !(typeof args.target_id === 'number' && Number.isSafeInteger(args.target_id) && args.target_id > 0)) ||
      (args.target_name != null && !str(args.target_name, 200)) || (args.value != null && !str(args.value, 2000))) {
    throw new Error('Invalid Pathfinder tool arguments');
  }
  if (args.action !== 'done' && (typeof args.target_id !== 'number' || !str(args.target_name, 200) || !args.target_name.trim())) throw new Error('Target id and name are required');
  if (args.action === 'fill' && typeof args.value !== 'string') throw new Error('Fill value is required');
  return { thought: '', action: args.action as Action['action'], message: args.message,
    goal_id: args.goal_id, target_id: args.target_id as number | null | undefined,
    target_name: args.target_name as string | undefined, value: args.value as string | null | undefined };
}

export function validateLiveAction(raw: Action, mode: Mode, manifest: SiteManifest, pageModel: string): Action {
  const action = validateAction(raw, mode, manifest, pageModel);
  const blocked = (message: string): Action => ({ ...action, action: 'explain', target_id: null, value: null, message, policy_blocked: true });
  if (action.action !== raw.action || action.policy_blocked || raw.policy_blocked) return blocked(action.message);
  if (!manifest.goals.some(g => g.id === action.goal_id)) return blocked('Unknown goal. Ask which supported goal to work on.');
  if (['highlight', 'scroll', 'fill', 'click'].includes(action.action)) {
    const targets = [...pageModel.matchAll(/^\[(\d+)\] [^\n]*?"([^"\n]*)"([^\n]*)$/gm)];
    const byId = targets.find(m => Number(m[1]) === action.target_id);
    const byName = targets.filter(m => !!action.target_name && m[2] === action.target_name);
    // Keep a missing id so the existing executor can resolve by accessible name.
    // An id that now names something different must never act on that element.
    if (byId && action.target_name && byId[2] !== action.target_name) return blocked('Target changed. Request a fresh target from the current page.');
    const target = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (!target) return blocked('Target is not on the current page. Ask for a fresh target.');
    if (['fill', 'click'].includes(action.action) && /\bdisabled\b/.test(target[3])) return blocked('Target is disabled. Wait for the user to complete the required fields.');
  }
  return action;
}

export function materialPage(text: string): string { return text.replace(/\nCHANGES SINCE LAST STEP:.*$/s, ''); }

// The transport sends cumulative text under a stable id. The UI upserts by id,
// so finished/turn-complete events cannot produce a second chat bubble.
export class LiveTranscripts {
  private sequence = 0;
  private turns = new Map<'user' | 'agent', { id: string; text: string; finished?: boolean }>();
  constructor(private readonly prefix: string) {}
  add(role: 'user' | 'agent', chunk: string, finished = false): Extract<LiveServerMessage, { type: 'transcript' }> | null {
    if (!chunk) return null;
    const previous = this.turns.get(role);
    const turn = previous && (!previous.finished || previous.text === chunk) ? previous : { id: `${this.prefix}:${++this.sequence}`, text: '' };
    if (chunk !== turn.text) turn.text = chunk.startsWith(turn.text) ? chunk : turn.text + chunk;
    turn.text = turn.text.slice(0, 8000);
    turn.finished = finished;
    this.turns.set(role, turn);
    return { type: 'transcript', role, id: turn.id, text: turn.text.trim() };
  }
  markFinished(role: 'user' | 'agent'): void { const turn = this.turns.get(role); if (turn) turn.finished = true; }
  finish(role?: 'user' | 'agent'): void { if (role) this.turns.delete(role); else this.turns.clear(); }
}
