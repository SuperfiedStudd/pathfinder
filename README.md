# Pathfinder

An onboarding guide that reads the page instead of following a script.

A user tells Pathfinder what they are trying to get done on a website. Pathfinder looks at the live page, points at the next thing, waits for the user to act, looks again, and repeats until the outcome is visibly complete. Nothing is authored per flow. The same agent runs on a nonprofit donation site and on a SaaS setup wizard.

Built for the Berkeley x DeepMind Hackathon (September 27, 2026) on Gemini 3.8 Flash through the Interactions API, deployed from Google AI Studio to Cloud Run.

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
client/src/widget/     the SDK. Touches the host page only through DOM APIs.
  extract.ts           DOM -> compact text page model, stable ids, change summary
  redact.ts            sensitive value masking
  overlay.ts           highlight box and tooltip
  actions.ts           executors: highlight, explain, scroll, ask, wait, done, fill, click
  loop.ts              observe -> decide -> act -> wait for change
  Widget.tsx           chat panel, mode toggle, consent, confirmations, drawer
  mount.tsx            mountOnboarding(siteId)
client/src/sites/      two demo sites: canopy (nonprofit) and ledgerly (CRM wizard)
server/                Express: /api/health, /api/decide (Gemini Interactions API), mock decider
shared/                action schema, manifests, policy (used by both sides)
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

## AI Studio and Cloud Run

AI Studio Build imports from GitHub and syncs both ways. Link this repository in Settings, GitHub tab, pull, then Deploy to Cloud Run. The Gemini key is injected as a server-side secret by AI Studio; this app reads it from `GEMINI_API_KEY`, which is the same name AI Studio uses. If AI Studio's import rewrites the server entry, keep `server/prompt.ts`, `server/gemini.ts` and the two routes from `server/index.ts`.

## Team

Tanmay Kallakuri and team. See `docs/PLAN.md` for the build plan, test matrix and hackathon-day timeline.
