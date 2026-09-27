import "./env";
import express, { type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getManifest, publicSite, originAllowed, registeredOrigin } from "./sites";
import { isMode, validateAction, effectiveMode } from "../shared/policy";
import { MAX_PAGE_MODEL_CHARS, type DecideRequest, type DecideResponse, type DecideErrorResponse } from "../shared/schema";
import { buildSystemPrompt, buildUserTurn } from "./prompt";
import { decideWithGemini, decideWithMock, MODEL, MOCK } from "./gemini";
import { createVoiceRouter } from "./voice";
import { classifyModelError } from "./model-errors";
import { attachLiveServer } from "./live";
import { LIVE_MODEL } from "../shared/live";
import packageInfo from "../package.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Browser origin and site must agree before any site data or model endpoint is used.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) { next(); return; }
  const siteId = req.path.startsWith('/api/sites/') ? decodeURIComponent(req.path.slice('/api/sites/'.length))
    : typeof req.headers['x-pathfinder-site'] === 'string' ? req.headers['x-pathfinder-site'] : '';
  if (req.path.startsWith('/sdk/') || req.path === '/live-pcm-worklet.js') {
    if (!registeredOrigin(origin) && !originAllowed(siteId, origin, req.headers.host)) { res.status(403).end(); return; }
  } else if (req.path.startsWith('/api/') && !(req.method === 'OPTIONS' && registeredOrigin(origin)) && !(req.path === '/api/health' && registeredOrigin(origin)) && !originAllowed(siteId, origin, req.headers.host)) {
    res.status(403).json({ error: 'Origin is not registered for this site.' }); return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pathfinder-Site');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});
app.use("/api/voice", createVoiceRouter());
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sdk: true, sdkVersion: packageInfo.version, model: MOCK ? "mock" : MODEL, liveModel: LIVE_MODEL });
});

app.get('/api/sites/:siteId', (req, res) => {
  const site = publicSite(req.params.siteId);
  if (!site) { res.status(404).json({ error: 'Unknown site.' }); return; }
  res.json(site);
});

function parseBody(body: unknown): { ok: true; req: DecideRequest } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.siteId !== "string" || !getManifest(b.siteId)) return { ok: false, error: "unknown siteId" };
  if (!isMode(b.mode)) return { ok: false, error: "mode must be guide or assist" };
  if (typeof b.goal !== "string" || !b.goal.trim()) return { ok: false, error: "goal is required" };
  if (typeof b.pageModel !== "string") return { ok: false, error: "pageModel must be a string" };
  if (b.pageModel.length > MAX_PAGE_MODEL_CHARS) return { ok: false, error: `pageModel over ${MAX_PAGE_MODEL_CHARS} chars` };
  const transcript = Array.isArray(b.transcript) ? (b.transcript as DecideRequest["transcript"]).slice(-10) : [];
  const recentActions = Array.isArray(b.recentActions) ? (b.recentActions as DecideRequest["recentActions"]).slice(-6) : [];
  return {
    ok: true,
    req: {
      siteId: b.siteId,
      mode: b.mode,
      goal: b.goal.trim().slice(0, 500),
      transcript,
      recentActions,
      pageModel: b.pageModel,
    },
  };
}

app.post("/api/decide", async (request: Request, response: Response) => {
  const parsed = parseBody(request.body);
  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  const req = parsed.req;
  if (request.headers.origin && request.headers["x-pathfinder-site"] !== req.siteId) {
    response.status(403).json({ error: "Site mismatch." }); return;
  }
  const manifest = getManifest(req.siteId)!;
  const mode = effectiveMode(req.mode, manifest);
  const started = Date.now();
  const requestId = randomUUID();

  try {
    const raw = MOCK
      ? decideWithMock(req, manifest)
      : await decideWithGemini(buildSystemPrompt(manifest, mode), buildUserTurn(req));
    const action = validateAction(raw, mode, manifest, req.pageModel);
    const latencyMs = Date.now() - started;
    // Never log the page model or the transcript; they contain user data.
    console.log(`[decide] request=${requestId} site=${req.siteId} mode=${mode} action=${action.action} target=${action.target_id ?? "-"} blocked=${action.policy_blocked ? 1 : 0} ${latencyMs}ms`);
    const out: DecideResponse = { action, latencyMs, model: MOCK ? "mock" : MODEL };
    response.json(out);
  } catch (err) {
    const failure = classifyModelError(err);
    const latencyMs = Date.now() - started;
    console.error(`[decide] request=${requestId} site=${req.siteId} code=${failure.code} provider_status=${failure.providerStatus ?? "unknown"} ${latencyMs}ms`);
    const out: DecideErrorResponse = {
      error: failure.error, code: failure.code, requestId,
      model: MOCK ? "mock" : MODEL, latencyMs,
    };
    response.status(failure.httpStatus).json(out);
  }
});

// Production: serve the built client and fall back to index.html for client routes.
const sdkDist = path.resolve(here, '../dist/sdk');
if (fs.existsSync(sdkDist)) app.use('/sdk', express.static(sdkDist));
const dist = path.resolve(here, "../dist/client");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

const port = Number(process.env.PORT || 8787);
const server = app.listen(port, () => {
  console.log(`server listening on ${port} (model: ${MOCK ? "mock, no GEMINI_API_KEY" : MODEL})`);
});
attachLiveServer(server);
