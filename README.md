# Pathfinder SDK

AI-powered onboarding for any website.

Add one script. Declare outcomes. Pathfinder understands the live UI and guides or assists users toward those outcomes with Gemini Live.

```html
<script src="https://YOUR_PATHFINDER_HOST/sdk/pathfinder.js"
  data-pathfinder-site="your-site"
  data-pathfinder-api="https://YOUR_PATHFINDER_HOST" defer></script>
```

### 1. Register your site

Add a typed registration in `server/sites.ts` with a site ID, a public manifest, and exact allowed origins. See [SDK integration](docs/SDK.md).

### 2. Add the SDK

Use the script above on any ordinary HTML site. The standalone bundle includes the widget and its styles. Modern frontends can use the ESM artifact at `dist/sdk/pathfinder.es.js` and call `Pathfinder.init({ siteId, apiBaseUrl })`.

### 3. Declare outcomes

```ts
goals: [{ id: 'workspace', title: 'Finish workspace setup', doneWhen: 'The workspace dashboard is visible' }]
```

### 4. Pathfinder handles the path

There are no authored tours. Pathfinder reads the current page, explains the next action, and can perform safe Assist actions after user consent.

## Google AI Studio

Open Google AI Studio Build, choose Add files, and import `SuperfiedStudd/pathfinder` from GitHub on the existing main branch. Configure `GEMINI_API_KEY` as a server secret, run the preview, approve microphone permission, and use GitHub sync for future changes. Deploy to Cloud Run when ready. Cloud Run deployment has not been verified in this repository.

## The idea

Every digital adoption platform (WalkMe, Pendo, Appcues, Whatfix, Userpilot) sells the same thing: someone authors a step-by-step flow, the product ships it, and the flow breaks the next time the UI changes. Authoring and maintaining flows is the cost center of that entire category.

Pathfinder inverts it. A site declares outcomes, not steps:

```ts
goals: [
  { id: "workspace", title: "Finish workspace setup",
    doneWhen: "The dashboard checklist shows Organization, Pipeline and Integrations complete." }
]
```

The path from wherever the user is to that outcome is the model's output on every turn, computed from the user's intent, the site's declared outcomes, and a text model of the current page. When the UI changes, nothing needs to be re-authored.

Two modes:

- Guide (v0, default): Pathfinder highlights and explains. It never fills or clicks. The user learns the product by doing it.
- Do it for me (v1, opt-in per site): with the user's consent, Pathfinder fills fields and presses buttons, showing each action before it runs, with an audit trail. This is the upgrade path: a new customer signs up to a tool and says "set it up for a two-person coffee roaster" and it happens.

## Why this is not a browser agent

Project Mariner, Operator and Browser Use act on the user's behalf from the outside. Pathfinder is installed by the site owner, runs inside the page, and defaults to guidance. That gives it three things a browser agent cannot have:

1. First-party page context (an accessibility-tree style model, not screenshots), which is cheaper per step and does not guess at labels.
2. A permission model the site controls: which mode is allowed, which fields are never touched.
3. A product outcome the vendor wants: the user ends up knowing the product, not bypassing it.

## Security model

- Sensitive fields (password inputs, anything inside `data-pf-sensitive`, payment autocomplete tokens, card, CVC, SSN and similar labels) are reported to the model only as `[filled]` or `[empty]`. The value never leaves the browser.
- The Gemini API key lives on the server. The browser calls `POST /api/decide`; the server calls Gemini with `store: false`, so page content is not retained.
- A per-mode allowlist is enforced both server-side and client-side. If the model returns a fill in guide mode, it is downgraded to an explanation and flagged in the UI.
- Sensitive fields are refused as fill or click targets in every mode.
- Page content is treated as untrusted input; the system prompt says so, and the loop caps at 30 steps per goal with a repeat breaker.
- The widget has a "What the guide sees" drawer that shows the exact page model sent, the action returned, latency, and every action taken on the page.

## Architecture

```
client/src/widget/     the embedded widget. Touches the host page only through DOM APIs.
  extract.ts           DOM -> compact text page model, stable ids, change summary
  redact.ts            sensitive value masking
  overlay.ts           highlight box and tooltip
  actions.ts           executors: highlight, explain, scroll, ask, wait, done, fill, click
  loop.ts              observe -> decide -> act -> wait for change
  Widget.tsx           chat panel, mode toggle, consent, confirmations, drawer
client/src/sdk/        public init API, auto-init script, endpoint transport
client/src/sites/      two demo sites: canopy (nonprofit) and ledgerly (CRM wizard)
server/                Express: public site registry, CORS, Gemini, Live relay, Chirp fallback
shared/                action schema, policy, and server manifest definitions
```

One step: snapshot the DOM into text lines, mask sensitive values, POST `{siteId, mode, goal, transcript, recentActions, pageModel}`, the server builds the prompt and calls Gemini with a JSON schema for the action, validates it against the mode allowlist, the client executes it and waits for a trigger (user reply, Done button, a change on the highlighted field, a meaningful DOM mutation, or a route change).

The page model looks like this:

```
URL /ledgerly/setup?step=1   TITLE Pathfinder
[9] label "Organization name" visible in-viewport
[10] input(text) "Organization name" value="Acme Roasters" visible in-viewport
[12] select "Industry" selected="Choose one" visible in-viewport
[14] input(radio) "Just me" checked=false visible in-viewport
[18] button "Continue" disabled visible in-viewport
CONTENT: Step 1 of 5 Tell us about your organization ...
CHANGES SINCE LAST STEP: ~[10] value="Acme Roasters"
```

## Demo sites

- Canopy Collective (`/canopy`): a fictional nonprofit. Home, Programs, Donate (with card fields marked sensitive), Volunteer, and a receipt page. Goal: "I want to support tree planting in cities but I do not know how this org works."
- Ledgerly CRM (`/ledgerly`): a fictional five-step workspace wizard with a dashboard checklist. Different layout, theme and vocabulary from Canopy on purpose. Goal: "Help me set up my workspace." Then switch on Do it for me.

Neither site has hardcoded ids or hints for the agent; both are driven purely from the page model.

## Run locally

```
npm install
cp .env.example .env        # add GEMINI_API_KEY; leave it empty to use the mock decider
npm run dev                 # client on :5173, server on :8787
```

`npm run typecheck`, `npm test` (policy and extractor tests under jsdom), `npm run build` then `npm start` serves the built client and the API on one port. `scripts/decide-smoke.sh` posts a fixture page model to `/api/decide`.

Environment: `GEMINI_API_KEY`, `PF_MODEL` (default `gemini-3.8-flash`, use `gemini-3.5-flash-lite` for cheap development), `PF_MOCK=1` to force the mock, `PORT`.

## Chirp fallback setup

Gemini Live is the primary voice path. The smaller mic button is optional push to talk through Chirp. Browser audio goes to the server's `/api/voice/transcribe` endpoint, then the normal `OnboardingLoop.send(transcript)` path runs. New agent messages go to `/api/voice/speak` for MP3 playback. Google Cloud credentials stay on the server. Recording stops automatically after 55 seconds; Google's synchronous STT limit is one minute or 10 MB, and this server caps uploads at 8 MB. Text remains usable if microphone permission is denied or voice setup is incomplete.

1. In your Google Cloud project, enable **Cloud Speech-to-Text API** (`speech.googleapis.com`) and **Cloud Text-to-Speech API** (`texttospeech.googleapis.com`), for example with `gcloud services enable speech.googleapis.com texttospeech.googleapis.com --project=YOUR_PROJECT_ID`. Make sure billing is enabled and your identity has permission to use both APIs.
2. Install the Google Cloud CLI, then run `gcloud auth application-default login`. Set its quota project with `gcloud auth application-default set-quota-project YOUR_PROJECT_ID` if it is not already set. Keep the generated ADC credentials outside this repository; do not add service account JSON here.
3. Set `GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID` in the repo-root ignored `.env`. `PF_STT_LOCATION=us` selects the supported Speech-to-Text V2 Chirp 3 multi-region endpoint; `PF_TTS_VOICE=en-US-Chirp3-HD-Charon` is the default HD voice. Both optional settings can be omitted to use these defaults. Keep `GEMINI_API_KEY` set for real agent reasoning; `PF_MOCK=1` only mocks Gemini, not voice.
4. Use Node.js 22 or newer for the Google client libraries. Run `npm install` and `npm run dev`, then open `http://localhost:5173/canopy`. Press the mic, say “I want to support tree planting in cities”, and press it again. The transcript should appear as a normal user message, Gemini should produce the normal Pathfinder action, and its agent message should play through Chirp 3 HD. Repeat at `http://localhost:5173/ledgerly`. Use the speaker control to mute or unmute responses.

Microphone capture requires a secure context; `localhost` works for local development. Chirp calls require working Google Cloud credentials even when the Gemini mock is active. API enablement and a live voice round trip have not been verified by this repository's automated tests.

Google references: [Chirp 3 STT model and regions](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp-model), [supported audio encodings](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/projects.locations.recognizers), [Chirp 3 HD voices](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), and [local Application Default Credentials](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment).

## Team

Tanmay Kallakuri and team. See `docs/PLAN.md` for the build plan, test matrix and hackathon-day timeline.

## Hands-free Live voice

Click **Start voice** once to open a server-owned `gemini-3.8-live` session. Allow microphone access, wait for **Listening**, then speak naturally. Gemini detects turns and streams its own audio; speak over it to interrupt. **Stop voice** releases the microphone. Typed messages during Live use the same Live session; after stopping, text returns to the normal Flash `/api/decide` path. The smaller mic button remains the Chirp push-to-talk fallback and is available when Live is off.

Live uses the existing `GEMINI_API_KEY` (no ADC requirement for Live itself) and `/api/live` WebSocket endpoint. Both `npm run dev` and the built server support the relay. The key stays on the server. Existing guide/assist policy, confirmations, sensitive-field protection, completion checks and browser executor still govern actions.

See [Live implementation and manual test guide](docs/LIVE_VOICE.md) for architecture, limitations and the manual checklist. To run one paid protocol smoke session without a microphone:

```bash
npm run build
PORT=8788 npm start
# In another terminal:
node --import tsx scripts/live-smoke.ts http://localhost:8788
```

Live is a demo prototype: a session ends at nine minutes or on provider disconnection; reconnect explicitly with **Start voice**. Chat text remains visible. No session resumption, persistence, production authentication, video or screen streaming is included.
