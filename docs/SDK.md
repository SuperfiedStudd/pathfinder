# Pathfinder SDK

Pathfinder adds AI onboarding to an ordinary website. Your registration declares goals as outcomes. The browser SDK reads a sanitized view of the host DOM, shows guidance, and can perform consented Assist actions in that DOM. The backend owns Gemini credentials and site policy.

## Install with one script

```html
<script src="https://YOUR_PATHFINDER_HOST/sdk/pathfinder.js"
  data-pathfinder-site="your-site"
  data-pathfinder-api="https://YOUR_PATHFINDER_HOST" defer></script>
```

The script exposes `window.Pathfinder` and initializes automatically when `data-pathfinder-site` is present. `data-pathfinder-api` defaults to the page origin. Use an HTTPS backend for HTTPS hosts.

## Install as a module

The build creates `dist/sdk/pathfinder.es.js`, which exports `Pathfinder`. The package export points to the same entry:

```js
import { Pathfinder } from '@pathfinder/sdk';
const instance = Pathfinder.init({ siteId: 'your-site', apiBaseUrl: 'https://YOUR_PATHFINDER_HOST' });
// When the host app is torn down:
instance.destroy();
```

For the current repository, import the built ESM file directly or configure a local package alias. Publishing to npm is outside this phase.

## Register a site

Add a typed registration in `server/sites.ts`. The server holds the full registration and its allowed origins; `GET /api/sites/:siteId` returns only public manifest fields.

```ts
registerSite({
  siteId: 'acme',
  manifest: {
    siteName: 'Acme', about: 'A workspace app',
    goals: [{ id: 'workspace', title: 'Finish setup', doneWhen: 'The workspace dashboard is visible' }],
    clarify: [],
    policy: { defaultMode: 'guide', allowAssist: true },
  },
  allowedOrigins: ['https://app.acme.com'],
});
```

Outcomes are statements of completion. Do not author selector based tour steps. Guide highlights and explains. Assist may fill safe fields and click after the user enables it and confirms actions. Sensitive fields remain masked and cannot be acted on.

## Lifecycle and security

`Pathfinder.init({siteId, apiBaseUrl?, container?})` returns `{destroy()}`. Repeating the same initialization returns the active instance. Destroy closes Live voice, stops audio, disconnects observers, and removes overlays and styles; initialization can then run again. Call `destroy()` when an SPA removes its integration. The SDK tracks host DOM changes and route changes through DOM mutations, `popstate`, and the `pf:navigate` event.

The SDK runs inside the customer page, so action execution targets that page's DOM. Only sanitized page text goes to the backend. The server checks the site's registered origin for API calls and WebSocket upgrades. The WebSocket also binds the site ID in the URL to the first Live message. `GEMINI_API_KEY` belongs only on the backend.

## Voice

Live voice needs a secure context and microphone permission. Production integrations should use HTTPS for both site and backend. The backend serves the audio worklet and relays PCM to Gemini Live. Chirp recording and speech playback are optional fallback features; they may report unavailable when Google Cloud credentials are absent.

## Local development

```sh
npm install
npm run build
PORT=8788 npm start
python3 -m http.server 9090 --directory examples/sdk-host
```

Open `http://localhost:9090`. The example registers `sdk-demo` for that origin. It imports no Pathfinder source code and uses only the standalone script.

## Troubleshooting

- No widget: check the site ID, backend URL, `/api/sites/:siteId`, and the browser console.
- 403: register the exact scheme, hostname, and port in `allowedOrigins`.
- Voice unavailable: allow the microphone, use HTTPS outside localhost, and check backend `GEMINI_API_KEY` and Live access.
- Chirp unavailable: configure Google Cloud ADC and the speech project only if you need the fallback.
