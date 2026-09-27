# Pathfinder

Pathfinder is an AI onboarding SDK for websites. Add one script and declare the outcomes users should reach; Pathfinder reads the live UI, talks users through it with Gemini Live, or completes approved actions for them. No authored product tours.

## Live Demo

[Try Pathfinder](https://pathfinder-007.ai.studio/) · [Source on GitHub](https://github.com/SuperfiedStudd/pathfinder)

## Why Pathfinder

Traditional onboarding tools ask teams to author tours, selectors, steps, and branches, then maintain them as the UI changes. Pathfinder reasons from the user's intent, site-declared outcomes, and the current page state to choose the next step.

## What It Can Do

- Read a compact, sanitized model of the live DOM and refresh it as the page or route changes.
- In **Guide** mode, highlight, scroll, and explain while the user acts.
- In **Assist** (“Do it for me”) mode, fill safe fields and click controls after the user opts in and confirms actions where appropriate. Confirmations offer **Allow**, **Edit**, and **Skip**.
- Converse through Gemini Live with streamed audio, transcripts, and interruption when the user speaks over the response. An optional Chirp push-to-talk path provides a fallback.
- Validate actions against site policy and visible completion conditions; protect sensitive controls from model-directed fills and clicks.
- Embed the same SDK on a separate host page, as shown by the external SDK example.

## How It Works

```text
Customer website
       ↓
Pathfinder SDK
       ↓
Sanitized page model
       ↓
Pathfinder backend
       ↓
Gemini 3.8 Flash / Gemini 3.8 Live
       ↓
Validated action
       ↓
Host DOM
```

The browser sends a sanitized page model to the backend. Gemini credentials remain server-side; the backend and browser validate actions before execution.

## SDK Integration

Register a site ID, its outcome manifest, and its allowed origins on the Pathfinder backend first. Then add the standalone script to that site's page:

```html
<script
  src="https://pathfinder-007.ai.studio/sdk/pathfinder.js"
  data-pathfinder-site="YOUR_SITE_ID"
  data-pathfinder-api="https://pathfinder-007.ai.studio"
  defer>
</script>
```

The script initializes automatically. For module or manual API usage, the ESM build exports `Pathfinder`:

```js
import { Pathfinder } from '@pathfinder/sdk';

const instance = Pathfinder.init({
  siteId: 'YOUR_SITE_ID',
  apiBaseUrl: 'https://pathfinder-007.ai.studio',
});

// When the host app removes the integration:
instance.destroy();
```

The package is not published to npm; use the built ESM artifact or a local package alias. See the [SDK integration guide](docs/SDK.md) for registration, lifecycle, and local external-host setup.

## Demo Apps

- **Canopy Collective:** a fictional nonprofit for Guide-oriented onboarding.
- **Ledgerly CRM:** a fictional workspace setup flow for Assist actions.
- **External SDK demo:** an unrelated static host page in `examples/sdk-host/`, using the standalone bundle from another origin.

## Gemini Stack

- **Gemini 3.8 Flash** handles text decisions through the backend.
- **Gemini 3.8 Live** handles continuous voice conversation and tool actions through a server relay.
- `GEMINI_API_KEY` is configured on the server, never in the browser bundle.
- Google Cloud Chirp speech-to-text and text-to-speech provide an optional push-to-talk fallback when separately configured.

## Safety and Agency

Guide mode blocks fill and click actions. Assist requires a site that permits it, user opt-in, and confirmation controls for proposed mutations. Sensitive fields are masked in the page model and refused as action targets. Site manifests define allowed outcomes, completion gates check visible evidence, and registered-origin checks guard external SDK HTTP and Live connections. The widget's “What the guide sees” drawer shows the page model and action history.

## Running Locally

Node.js 22 or newer is recommended for the Google Cloud client libraries. Copy `.env.example` to an ignored `.env`; replace the `GEMINI_API_KEY` placeholder for real Gemini calls, or clear it to use the mock decider. `PF_MODEL` selects the text model, `PF_MOCK=1` forces the mock, and `PORT` selects the Express port. `GOOGLE_CLOUD_PROJECT`, `PF_STT_LOCATION`, and `PF_TTS_VOICE` configure the optional Chirp fallback. Keep credentials out of the repository.

```sh
npm install
cp .env.example .env
npm run dev
```

`npm run dev` runs Vite on port 5173 with HMR and Express on port 8787. Open `http://localhost:5173/canopy` or `/ledgerly`.

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` serves the built client, SDK, and API from Express. For external-host local testing, follow [docs/SDK.md](docs/SDK.md).

## Production Build

`npm run build` writes the client to `dist/client/` and the SDK artifacts to `dist/sdk/pathfinder.js`, `dist/sdk/pathfinder.es.js`, and `dist/sdk/pathfinder.d.ts`.

## Testing

The repository has 100 passing automated tests at this release, alongside a passing typecheck and build. Tests cover policy, SDK transport and lifecycle, voice relay, action confirmation, and other core behavior. Browser microphone and paid Gemini round trips need separate manual verification; see [Live voice notes](docs/LIVE_VOICE.md).

## Project Structure

| Path | Purpose |
| --- | --- |
| `client/src/sdk/` | Public SDK and transport |
| `client/src/widget/` | On-page UI, DOM model, actions, and voice |
| `server/` | API, site registry, Gemini, and voice relay |
| `shared/` | Manifests, schemas, and policy |
| `examples/sdk-host/` | Independent HTML host example |
| `docs/` | Integration and implementation notes |
| `test/` | Automated tests |

## Hackathon

Pathfinder was built for the Berkeley x Google DeepMind hackathon. Historical planning and implementation notes are kept in `docs/` for context.
