import { GoogleGenAI } from "@google/genai";
import { ACTION_SCHEMA, type Action, type DecideRequest } from "../shared/schema";
import type { SiteManifest } from "../shared/manifests";

export const MODEL = process.env.PF_MODEL || "gemini-3.8-flash";
export const MOCK = process.env.PF_MOCK === "1" || !process.env.GEMINI_API_KEY;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// One call per agent step. Stateless on purpose: the page model changes on
// every turn, so server-side conversation state buys nothing here, and
// store:false keeps page content out of retention.
export async function decideWithGemini(systemInstruction: string, userTurn: string): Promise<unknown> {
  const interaction = await getClient().interactions.create({
    model: MODEL,
    system_instruction: systemInstruction,
    input: userTurn,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: ACTION_SCHEMA as unknown as Record<string, unknown>,
    },
    generation_config: { thinking_level: "low" },
    store: false,
  });

  const text = interaction.output_text ?? "";
  const cleaned = text.replace(/^```json\s*|```\s*$/g, "").trim();
  return JSON.parse(cleaned);
}

interface ModelLine {
  id: number;
  tag: string;
  type: string;
  name: string;
  rest: string;
}

function parseLines(pageModel: string): ModelLine[] {
  const out: ModelLine[] = [];
  const re = /^\[(\d+)\]\s+(\w+(?:\[\w+\])?)(?:\(([^)]*)\))?\s+"([^"]*)"(.*)$/;
  for (const line of pageModel.split("\n")) {
    const m = re.exec(line.trim());
    if (m) out.push({ id: Number(m[1]), tag: m[2], type: m[3] || "", name: m[4], rest: m[5] || "" });
  }
  return out;
}

// Heuristic stand-in for the model so the whole loop can be exercised with
// no API key. It is intentionally dumb; its only job is to drive the widget.
export function decideWithMock(req: DecideRequest, manifest: SiteManifest): Action {
  const pm = req.pageModel;
  const lines = parseLines(pm);
  const visible = lines.filter((l) => l.rest.includes("visible"));

  if (/receipt number|Workspace ready|Thank you for volunteering/i.test(pm)) {
    return {
      thought: "The confirmation is on screen.",
      action: "done",
      message: "That is everything. The confirmation is on screen, so this goal is complete.",
      goal_progress: "complete",
    };
  }

  const agentTurns = req.transcript.filter((t) => t.role === "agent").length;
  if (manifest.clarify.length > 0 && agentTurns === 0) {
    return {
      thought: "Need context before recommending a template.",
      action: "ask",
      message: "Quick check before we set this up. What best describes your business, and is it just you or a team?",
      options: ["Solo, I sell services", "Small team, we sell products", "Agency with clients", "Something else"],
      goal_progress: "gathering context",
    };
  }

  const emptyInput = visible.find(
    (l) =>
      (l.tag === "input" || l.tag === "textarea" || l.tag === "select") &&
      (l.rest.includes('value=""') || l.rest.includes('value="[empty]"') || /selected="(|Choose one|Select|Select one)"/.test(l.rest)) &&
      !l.rest.includes("disabled"),
  );
  if (emptyInput) {
    const sensitive = emptyInput.rest.includes("[empty]");
    return {
      thought: "First empty field on the current step.",
      action: "highlight",
      target_id: emptyInput.id,
      message: sensitive
        ? `Enter your ${emptyInput.name} directly in this field. I never see this value.`
        : `Fill in ${emptyInput.name} here. When you are done, move to the next field and I will follow along.`,
      goal_progress: "filling the current step",
    };
  }

  const isRadio = (l: ModelLine) => l.type === "radio" || l.tag.endsWith("[radio]");
  const unchecked = visible.find((l) => isRadio(l) && l.rest.includes("checked=false"));
  const anyChecked = visible.some((l) => isRadio(l) && l.rest.includes("checked=true"));
  if (unchecked && !anyChecked) {
    return {
      thought: "A choice has not been made yet.",
      action: "highlight",
      target_id: unchecked.id,
      message: `Pick an option here. ${unchecked.name} is a reasonable default if you are unsure.`,
      goal_progress: "choosing an option",
    };
  }

  const button = visible.find(
    (l) => l.tag === "button" && /donate|continue|proceed|next|send|finish|complete|connect|save|sign up/i.test(l.name) && !l.rest.includes("disabled"),
  );
  if (button) {
    return {
      thought: "The step looks complete, move forward.",
      action: "highlight",
      target_id: button.id,
      message: `Everything on this step is filled in. Press ${button.name} to continue.`,
      goal_progress: "advancing",
    };
  }

  const link = visible.find((l) => l.tag === "a" && /donate|get started|setup|start|volunteer/i.test(l.name));
  if (link) {
    return {
      thought: "Navigate toward the goal.",
      action: "highlight",
      target_id: link.id,
      message: `Open ${link.name} to get started. I will meet you on the next page.`,
      goal_progress: "navigating",
    };
  }

  return {
    thought: "Nothing obvious to do.",
    action: "explain",
    message: "I am not sure what to do on this screen. Tell me what you see or scroll a little and I will check again.",
    goal_progress: "unclear",
  };
}
