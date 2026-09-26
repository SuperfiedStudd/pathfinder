// Loads the repo-root .env into process.env without a dependency. It has to
// run before gemini.ts is evaluated, since MODEL and MOCK are read at module
// load, so server/index.ts imports it first. Values already set in the real
// environment win. Never log what is read here; it holds the API key.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");

try {
  const text = fs.readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env (or unreadable): fall back to the real environment.
}
