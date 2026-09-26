import { ACTION_TYPES, type Action, type ActionType, type Mode } from "./schema";
import type { SiteManifest } from "./manifests";

const GUIDE_ACTIONS: ActionType[] = ["highlight", "explain", "scroll", "ask", "wait", "done"];
const ASSIST_ACTIONS: ActionType[] = [...GUIDE_ACTIONS, "fill", "click"];

export const ALLOWED: Record<Mode, ActionType[]> = {
  guide: GUIDE_ACTIONS,
  assist: ASSIST_ACTIONS,
};

const NEEDS_TARGET: ActionType[] = ["highlight", "fill", "click"];

export function isMode(value: unknown): value is Mode {
  return value === "guide" || value === "assist";
}

export function effectiveMode(requested: Mode, manifest: SiteManifest): Mode {
  if (requested === "assist" && !manifest.policy.allowAssist) return "guide";
  return requested;
}

// Normalizes whatever the model returned into an action the executor can
// run. Anything outside the allowlist becomes an explain and is flagged so
// the UI can show that policy intervened.
export function validateAction(raw: unknown, mode: Mode, manifest: SiteManifest, pageModel: string): Action {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const action: Action = {
    thought: typeof obj.thought === "string" ? obj.thought : "",
    action: ACTION_TYPES.includes(obj.action as ActionType) ? (obj.action as ActionType) : "explain",
    target_id: typeof obj.target_id === "number" && Number.isSafeInteger(obj.target_id) && obj.target_id > 0 ? obj.target_id : null,
    target_name: typeof obj.target_name === "string" && obj.target_name.trim() ? obj.target_name : undefined,
    value: typeof obj.value === "string" ? obj.value : null,
    message: typeof obj.message === "string" && obj.message.trim() ? obj.message.trim() : "Let me take another look at the page.",
    options: Array.isArray(obj.options) ? obj.options.filter((o) => typeof o === "string").slice(0, 4) as string[] : undefined,
    goal_progress: typeof obj.goal_progress === "string" ? obj.goal_progress : undefined,
    goal_id: typeof obj.goal_id === "string" && obj.goal_id.trim() ? obj.goal_id : undefined,
  };

  const mode2 = effectiveMode(mode, manifest);
  if (!ALLOWED[mode2].includes(action.action)) {
    return {
      ...action,
      action: "explain",
      target_id: null,
      value: null,
      policy_blocked: true,
      message:
        mode2 === "guide"
          ? action.message || "In guide mode I only point things out. Go ahead and do that step yourself."
          : action.message,
    };
  }

  if (NEEDS_TARGET.includes(action.action) && (action.target_id === null || action.target_id === undefined)) {
    return {
      ...action,
      action: "explain",
      target_id: null,
      value: null,
      message: "I could not find that element on this screen. What do you see in front of you right now?",
    };
  }

  if (action.action === "ask" && (!action.options || action.options.length === 0)) {
    action.options = undefined;
  }

  // Deterministic completion gate: "done" only sticks once the goal's
  // doneMatch (when declared) actually appears in the page model. Otherwise
  // the model gets a chance to look again instead of ending the session.
  if (action.action === "done") {
    const goal =
      manifest.goals.find((g) => g.id === action.goal_id) ??
      (manifest.goals.length === 1 ? manifest.goals[0] : undefined);
    if (!goal) {
      return {
        ...action,
        action: "explain",
        target_id: null,
        value: null,
        message: "I cannot verify which goal is complete yet. What does the screen show right now?",
      };
    }
    if (goal.doneMatch && !new RegExp(goal.doneMatch, "i").test(pageModel)) {
      return {
        ...action,
        action: "explain",
        target_id: null,
        value: null,
        message: "I do not see the confirmation on this page yet. What does the screen show right now?",
      };
    }
  }

  return action;
}
