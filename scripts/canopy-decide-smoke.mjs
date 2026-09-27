// Captured from the real Canopy home page's Pathfinder debug panel.
// Run manually after changing Gemini billing/configuration; never part of tests.
import fs from "node:fs";

const base = process.argv[2] || "http://localhost:8787";
const count = Number(process.argv[3] || 3);
if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("Call count must be 1–5");
const goal = "Hi, I want to support tree planting in the city. Can you tell me how your organization works?";
const pageModel = fs.readFileSync(new URL("../test/fixtures/canopy-home.txt", import.meta.url), "utf8").trimEnd();
const health = await fetch(`${base}/api/health`).then((res) => res.json());
console.log("health", health);
if (!health.ok || health.model === "mock") throw new Error("Smoke test requires real Gemini");
for (let i = 0; i < count; i++) {
  const res = await fetch(`${base}/api/decide`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: "canopy", mode: "guide", goal, transcript: [{ role: "user", text: goal }], recentActions: [], pageModel }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json();
  // Only print operational metadata, never provider details or model text.
  console.log({ call: i + 1, status: res.status, code: data.code, model: data.model, latencyMs: data.latencyMs, action: data.action?.action, requestId: data.requestId });
  if (!res.ok) process.exitCode = 1;
}
