# Gemini Live voice prototype

## Baseline and preserved work

The stable pre-Live baseline was pushed to shared main at `ff53e26ae104cff3a526c4fc80499411255f5ac9` (`Add voice fallback and harden model diagnostics`). Stage 2 remains uncommitted and unpushed.

At continuation, these files already contained uncommitted work:

- Modified: `client/src/widget/loop.ts`, `package.json`, `package-lock.json`, `server/index.ts`, `vite.config.ts`.
- New: `client/public/live-pcm-worklet.js`, `client/src/widget/live-audio.ts`, `server/live.ts`, `shared/live.ts`.

Continuation completed those modules and additionally changed/added:

- `client/src/widget/live.ts`: browser session, media resources, page observer, relay events and reconnect lifecycle.
- `client/src/widget/Widget.tsx`, `client/src/widget/widget.css`: compact Live controls and transcript integration; existing confirmation UI reused.
- `test/live.test.ts`, `test/live-loop.test.ts`, `test/live-audio.test.ts`, `test/live-client.test.ts`, `test/live-server.test.ts`: focused protocol, policy, confirmation, transcript, playback and lifecycle tests.
- `scripts/live-smoke.ts`: one-session real API protocol smoke test.
- `README.md`, `docs/LIVE_VOICE.md`: usage and verification.

The existing Chirp implementation, Flash request path, model-error diagnostics, fixtures and prior docs are retained. The baseline dependency list adds `ws` and `@types/ws` for the Live relay; the existing `@google/genai` SDK is reused.

## Architecture and current API decisions

Browser microphone → AudioContext → AudioWorklet → binary PCM16 frames → same-origin `/api/live` WebSocket → server-owned Google GenAI SDK `ai.live.connect` → `gemini-3.8-live`.

Each browser socket owns one provider session. The server uses its existing environment key and `v1beta` Live endpoint. Only operational session IDs/error categories are logged; audio, page models, transcripts, credentials and provider exception bodies are not logged.

Configuration:

- Exact model: `gemini-3.8-live`.
- Response modality: `AUDIO`.
- Input and output audio transcription enabled.
- Automatic VAD enabled; Google's default silence tolerance (documented as approximately 800 ms) retained. No custom VAD.
- No thinking level/configuration, structured response format, affective dialogue or disabled proactivity.
- Function behavior explicitly `BLOCKING`.

Checked against current official docs:

- [Gemini 3.8 Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [SDK connection and streaming](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk)
- [Audio formats, VAD and interruptions](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Function calls](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Session and connection limits](https://ai.google.dev/gemini-api/docs/live-api/session-management)

## Audio, transcripts and UI

Input is mono PCM16 little-endian at 16 kHz in 20 ms frames (320 samples / 640 bytes). Web Audio resamples the hardware microphone through an explicitly requested 16 kHz context; unsupported contexts fail cleanly to text/fallback. Echo cancellation and noise suppression are requested. The AudioWorklet emits silent local output so microphone audio is not monitored through the speakers.

Output is PCM16 at 24 kHz. A separate playback context schedules each received chunk immediately with a short initial cushion. Current and scheduled sources are tracked, bounded against excessive backlog, and removed as they finish. There is no whole-response audio blob or MP3 encoding in Live mode.

A provider interruption immediately stops every scheduled audio source, clears the queue and returns the status to Listening. Input capture and the socket remain active. Provider tool cancellations dismiss pending confirmations; an already executed browser action is not rolled back.

Transcription chunks accumulate under stable turn IDs, and the existing chat messages are updated in place. Partial/cumulative/final updates do not append another bubble for the same ID. Input and output transcripts use normal user/agent roles. They never call `OnboardingLoop.send()`. Live agent messages are marked so Chirp does not synthesize them again. Typed messages and quick replies while Live is active go to the same Live session and explicitly interrupt playback. Audit messages remain separate.

The UI has Start voice / Stop voice and Connecting / Listening / Speaking / Voice error states. The smaller existing mic remains the secondary Chirp fallback. Stop voice restores normal Flash text behavior. The speaker toggle controls fallback Chirp speech and is disabled during native Live audio; Stop voice ends Live audio and capture.

## Tool and deterministic execution

One function is declared:

```text
pathfinder_action({
  action: "highlight" | "scroll" | "fill" | "click" | "done",
  target_id?: integer,
  target_name?: string,
  value?: string,
  message: string,
  goal_id: string
})
behavior: BLOCKING
```

Target id and exact accessible name are required at runtime for targeted actions; fill requires a value. Unknown properties/actions and malformed values are rejected. There is no selector or JavaScript argument.

The server normalizes arguments into the existing Action type and invokes `validateAction` via the Live adapter. Guide restrictions, site assist permission and goal completion gates still apply. The browser revalidates against its fresh snapshot/current mode. It also checks sensitive targets before showing mutation confirmation; the unchanged executor repeats sensitive checks when executing. Invalid/disabled targets and mismatched names are refused. The existing executor's exact unique accessible-name fallback remains available for disappeared IDs; ambiguous names are rejected.

Assist fill/click waits on the existing Allow / Edit / Skip controls unless Allow all for this goal is set. The blocking tool response is withheld until that choice resolves. Mode/target/completion checks run again after the confirmation delay. Changing goals resets Live allow-all consent, and starting a new Live session resets it. Skip, cancellation and timeout return truthful outcomes. The server queues additional tool requests behind the outstanding one so they are checked against the refreshed page model.

`actions.execute` and the existing Overlay perform the browser interaction. After execution/DOM settling, the result and a fresh compact snapshot are returned to Gemini in the tool response. Pure speech does not require a browser tool call.

## Page updates and session lifecycle

Initial context includes the trusted site manifest, goals, current goal/conversation, mode and compact `snapshot()` text. The system instruction labels page content as untrusted. Page updates use `sendClientContent` with `turnComplete: false`, so background changes do not request a new spoken turn or explicitly interrupt generation.

A local MutationObserver plus input/change/navigation/scroll/resize listeners schedule snapshot checks at most every 700 ms. Widget mutations are ignored. Only changed compact page content or mode is sent; the extractor's CHANGES summary alone does not count. No polling, full DOM stream or video is sent. Page models retain existing masking and a 12,000-character cap.

Stop, disconnect, permission failure, setup timeout and unmount release microphone tracks, both AudioContexts, worklet ports/nodes, playback sources, socket handlers, observers, timers and pending confirmations. A generation token prevents late microphone/connection results from resurrecting stopped sessions. WebSocket heartbeat detects lost clients; provider sessions close with the browser connection. Payload and backlog bounds prevent indefinite queuing. Browser-origin checking rejects cross-origin browser sockets, but this is not production authentication.

Google documents a roughly 10-minute connection lifetime and a 15-minute audio-only session limit without compression. This prototype stops at nine minutes or on GoAway/disconnect, then permits explicit reconnect. It does not resume provider session state; the latest visible conversation excerpt and page context seed the new session. Text and Chirp remain usable after Live failure.

## Verification and manual browser checklist

The real smoke test used one paid Live session. It connected to `gemini-3.8-live`, accepted text client content, returned 23 native-audio chunks (311,042 bytes), emitted output transcription, and completed one validated blocking highlight-tool exchange without auth/billing/model errors. The smoke response explicitly said that no DOM action was executed because no browser was attached. This verifies the real relay/protocol, not microphone quality or physical playback/barge-in.

Automated checks cover tool normalization, malformed socket messages, guide/site restrictions, target validation, completion gates, confirmation Allow/Edit/Skip, revalidation after a mode change, sensitive fields, unique-name fallback, transcript deduplication, playback interruption and cleanup/disconnect races. All 85 tests across nine test files pass, alongside typecheck, build and diff checks.

Manual steps:

1. Keep the existing `.env`. Run `npm run build`, then `PORT=8788 npm start` (or use the already running test server). Open `http://localhost:8788/canopy` in a microphone-capable browser. A localhost or HTTPS secure context is required. Headphones help avoid speaker echo during initial testing.
2. Click Start voice once and allow microphone access. Confirm Connecting changes to Listening. Say: “Hi, I want to support tree planting in the city. Can you tell me how your organization works?” Do not click Send or the fallback mic.
3. Confirm one user transcript and one agent transcript update in place, streamed audio starts before the turn finishes, and there are no `/api/decide` calls in browser Network while speaking in Live mode.
4. While Pathfinder speaks, interrupt with “Actually, show me how you work.” Confirm playback cuts off, the old queue does not resume, and the microphone keeps listening. Repeat with a natural mid-sentence pause to check turn detection.
5. Ask “Highlight How we work.” Confirm the existing overlay highlights the actual heading. Navigate manually to Programs; ask about that page and confirm fresh page awareness.
6. Open `http://localhost:8788/ledgerly/setup?step=1`. Choose Do it for me and accept existing assist consent. Start voice. Give business context, then ask it to fill Organization name with “Acme Roasters.” Confirm the field stays unchanged until Allow. Test Edit and Skip on later requests. Switch to Guide while confirmation is pending; Allow must not perform the mutation. Leave Allow all unchecked for these checks.
7. Ask to finish workspace setup before the Workspace ready banner exists. Confirm the goal is not reported complete. Sensitive fields must be entered directly on the page; do not speak real secrets during testing.
8. Type a short question while Live is active. Confirm the same Live session answers. Click Stop voice and verify the browser microphone indicator ends. Send a text question; verify normal Flash behavior resumes. Use the smaller fallback mic to confirm Chirp remains available.
9. Stop/restart the local server during Live to test disconnect handling. Confirm a concise voice error, released microphone, usable text/fallback, and a fresh connection after Start voice. Also deny microphone permission once and confirm text stays usable.

Remaining limitations: manual microphone, speaker echo, perceived VAD latency and human barge-in have not been automated. The real tool smoke verifies protocol only; DOM execution and confirmations are covered by focused tests and need this manual check. Sessions do not persist or resume, IDs only resolve within the current page, ambiguous fallback names fail safely, and a new site mount ends the old session. This is a local hackathon prototype, not a publicly authenticated service.
