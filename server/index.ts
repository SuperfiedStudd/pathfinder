import express, { type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getManifest } from "../shared/manifests";
import { isMode, validateAction, effectiveMode } from "../shared/policy";
import { MAX_PAGE_MODEL_CHARS, type DecideRequest, type DecideResponse } from "../shared/schema";
import { buildSystemPrompt, buildUserTurn } from "./prompt";
import { decideWithGemini, decideWithMock, MODEL, MOCK } from "./gemini";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MOCK ? "mock" : MODEL });
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
  const manifest = getManifest(req.siteId)!;
  const mode = effectiveMode(req.mode, manifest);
  const started = Date.now();

  try {
    const raw = MOCK
      ? decideWithMock(req, manifest)
      : await decideWithGemini(buildSystemPrompt(manifest, mode), buildUserTurn(req));
    const action = validateAction(raw, mode, manifest);
    const latencyMs = Date.now() - started;
    // Never log the page model or the transcript; they contain user data.
    console.log(`[decide] site=${req.siteId} mode=${mode} action=${action.action} target=${action.target_id ?? "-"} blocked=${action.policy_blocked ? 1 : 0} ${latencyMs}ms`);
    const out: DecideResponse = { action, latencyMs, model: MOCK ? "mock" : MODEL };
    response.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[decide] error site=${req.siteId}: ${message.slice(0, 300)}`);
    const status = /429|RESOURCE_EXHAUSTED/i.test(message) ? 429 : 502;
    response.status(status).json({ error: status === 429 ? "rate limited" : "model call failed", detail: message.slice(0, 300) });
  }
});

// Production: serve the built client and fall back to index.html for client routes.
const dist = path.resolve(here, "../dist/client");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`server listening on ${port} (model: ${MOCK ? "mock, no GEMINI_API_KEY" : MODEL})`);
});
