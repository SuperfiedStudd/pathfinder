// One real session, no microphone and no audio files. Run manually:
// node --import tsx scripts/live-smoke.ts [http://localhost:8788]
import fs from 'node:fs';
import WebSocket from 'ws';
import { LIVE_MODEL, validateLiveAction, type LiveServerMessage } from '../shared/live';
import { manifests } from '../shared/manifests';

const base = new URL(process.argv[2] || 'http://localhost:8788');
base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
base.pathname = '/api/live';
const pageModel = fs.readFileSync(new URL('../test/fixtures/canopy-home.txt', import.meta.url), 'utf8').trimEnd();
const ws = new WebSocket(base);
const result = { model: '', connected: false, nativeAudioChunks: 0, audioBytes: 0, outputTranscription: false, toolCalls: 0, validatedTools: 0, toolResultsSent: 0, completed: false };
let settled = false;
const timer = setTimeout(() => finish(false, 'LIVE_SMOKE_TIMEOUT'), 45_000);
function finish(ok: boolean, code?: string) {
  if (settled) return;
  settled = true; clearTimeout(timer);
  console.log(JSON.stringify({ ...result, ok, errorCode: ok ? null : code ?? 'LIVE_SMOKE_INCOMPLETE' }, null, 2));
  if (!ok) process.exitCode = 1;
  ws.close();
}
ws.on('open', () => ws.send(JSON.stringify({ type: 'start', context: { siteId: 'canopy', mode: 'guide', goal: 'Learn how Canopy works', pageModel, transcript: [] } })));
ws.on('message', bytes => {
  const message = JSON.parse(bytes.toString()) as LiveServerMessage;
  if (message.type === 'ready') {
    result.model = message.model; result.connected = message.model === LIVE_MODEL;
    ws.send(JSON.stringify({ type: 'text', text: 'Please highlight the How we work heading using pathfinder_action with goal_id learn. After the tool result, say one short sentence about Canopy.' }));
  } else if (message.type === 'audio') {
    result.nativeAudioChunks++; result.audioBytes += Buffer.from(message.data, 'base64').length;
  } else if (message.type === 'transcript' && message.role === 'agent' && message.text.trim()) {
    result.outputTranscription = true;
  } else if (message.type === 'action') {
    result.toolCalls++;
    const action = validateLiveAction(message.action, 'guide', manifests.canopy, pageModel);
    const valid = action.action === 'highlight' && action.target_id === 16 && action.target_name === 'How we work' && action.goal_id === 'learn' && !action.policy_blocked;
    if (valid) result.validatedTools++;
    // This is a protocol test, not a DOM executor. Report that truthfully.
    ws.send(JSON.stringify({ type: 'result', id: message.id, outcome: valid ? 'Protocol smoke: target validated. No browser is attached, so no DOM action was executed.' : 'Rejected by smoke validator: unexpected action.', pageModel }));
    result.toolResultsSent++;
  } else if (message.type === 'turn_complete') {
    result.completed = true;
    finish(result.connected && result.nativeAudioChunks > 0 && result.outputTranscription && result.validatedTools > 0 && result.toolResultsSent > 0, 'LIVE_SMOKE_INCOMPLETE');
  } else if (message.type === 'error') finish(false, message.code);
});
ws.on('error', () => finish(false, 'LIVE_SOCKET_ERROR'));
ws.on('close', () => { if (!settled) finish(false, 'LIVE_SOCKET_CLOSED'); });
