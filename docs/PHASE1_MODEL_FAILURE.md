# Phase 1: reproduced Gemini billing failure

Date: 2026-09-26. Phase 2 was intentionally not started: the user required a reliable real `/api/decide` path before Live work.

## Root cause and evidence

The exact Canopy utterance was reproduced in the actual browser widget:

> Hi, I want to support tree planting in the city. Can you tell me how your organization works?

The provider returned HTTP **402**, and inspection of the response confirmed a depleted/insufficient-credit message. The SDK exposed `APIError` with numeric `status: 402` and `statusCode: 402`, while its message obscured the useful response behind `httpMeta`. Pathfinder converted that into HTTP 502 with the generic `model call failed` message. The debug panel only recorded model, latency, and page snapshot on success, explaining the misleading `none yet / 0 ms / 0 steps` display.

This is a billing failure before any action is returned, not evidence of malformed structured output, a page-model size issue, or a transient 5xx. Google documents 402 as depleted prepay credits and advises against retrying until credits are added: https://ai.google.dev/gemini-api/docs/api-errors

The isolated reproduction server used the existing `.env` on port 8788. Its health endpoint returned `{"ok":true,"model":"gemini-3.8-flash"}`. No API key or raw provider response was saved in this report or fixtures.

## Fix and reliability result

- Added a fixed-message error classifier for billing, rate limiting, access, missing models/endpoints, rejected requests, upstream failures, parsing, network failures, and unknown failures.
- Removed raw SDK messages from `/api/decide` responses and server error logs.
- Added request IDs and safe status/category/timing metadata for diagnosis.
- Recorded the attempted page snapshot before the call and displayed failure model, latency, code, and request ID in the debug drawer.
- Kept HTTP 502 for an upstream billing failure, with the explicit `MODEL_BILLING_ERROR` category. HTTP 429 remains reserved for rate limiting.
- Added no retry: 402 requires billing remediation, not backoff.

Three identical Canopy calls after the change all returned `MODEL_BILLING_ERROR` (286, 171, 171 ms). One Ledgerly request returned the same category (231 ms). A further real browser request displayed the safe billing message and populated `gemini-3.8-flash`, 243 ms, the category, and its request ID. Zero completed steps remains correct because no action was returned.

**The error handling is fixed; successful model calls remain blocked by billing.** Schema/output behavior after billing is restored is not yet verified. No successful-call reliability claim can be made.

## Files changed in this task

- `server/model-errors.ts`: safe classification and fixed user messages.
- `server/index.ts`: safe failure response/logging and request correlation.
- `shared/schema.ts`: typed failure response and categories.
- `client/src/widget/loop.ts`: attempted snapshot and failed-call metadata.
- `client/src/widget/Widget.tsx`: error code/request ID in the debug drawer.
- `test/model-errors.test.ts`: 12 classification and no-content-leak tests.
- `test/fixtures/canopy-home.txt`: full compact page model captured from the actual browser debug drawer, including its content and element IDs.
- `scripts/canopy-decide-smoke.mjs`: repeatable real-model Canopy smoke test; prints operational metadata only and exits nonzero on failed calls.
- `docs/PHASE1_MODEL_FAILURE.md`: this report and manual steps.

All pre-existing uncommitted Chirp STT/TTS work was preserved. No commit or push was made.

## Validation

Before changes: typecheck, 22 tests, build, and `git diff --check` passed.
After changes: typecheck, 34 tests across four files, build, and `git diff --check` passed. Real Canopy and Ledgerly requests failed deterministically with the billing category, as described above. The browser error presentation was verified.

## Exact manual testing steps

1. Have the project owner restore Gemini API credits for the project associated with the existing `GEMINI_API_KEY`. Do not paste credentials into chat. This task did not change billing.
2. From the repository root, run `npm run build`, then `PORT=8788 npm start`. Port 8787 was already in use during this task; the isolated 8788 test server was stopped after verification.
3. Run `curl -s http://localhost:8788/api/health`. Confirm the model is `gemini-3.8-flash`, not `mock`.
4. Run `node scripts/canopy-decide-smoke.mjs http://localhost:8788 3`. All three calls must return HTTP 200 and a valid action. A nonzero exit indicates a failed request.
5. Run `bash scripts/decide-smoke.sh http://localhost:8788 guide`. Confirm HTTP 200 and a valid Ledgerly action; this existing script displays the status but does not fail its process on HTTP errors.
6. Open `http://localhost:8788/canopy`, optionally mute spoken responses, and enter the exact utterance above. Open “What the guide sees.” Confirm a real response, model, nonzero latency, and step count. While billing remains blocked, confirm the safe billing message/code/request ID instead.
7. Recheck the existing microphone → Chirp transcription → `/api/decide` → Chirp speech flow after the text request succeeds.
8. Proceed to Phase 2 only once these real calls succeed consistently.

## Phase 2 status and limitations

Live architecture, the `gemini-3.8-live` connection, VAD configuration, continuous PCM input, progressive native audio playback, function contract, page updates, barge-in, Live transcription, and disconnect handling were **not implemented**, in accordance with the Phase 1 stop condition. Live documentation research is deferred until that gate passes.

The existing deterministic policy, executor, completion gates, and Chirp fallback are unchanged. No Live transcript deduplication or realtime tests were introduced. The diagnostics are ready for manual browser testing; a working model conversation and Live voice demo remain blocked.
