import type { Action } from "@shared/schema";
import { getElementById } from "./extract";
import { isSensitive } from "./redact";
import type { Overlay } from "./overlay";

export interface ExecResult {
  outcome: string;
  // true: the loop parks until the user does something or the page changes.
  waitForUser: boolean;
  // when set, the loop runs the next step automatically after this delay
  autoAfterMs?: number;
  // when set, the loop waits for the DOM to settle before the next step
  settle?: boolean;
  finished?: boolean;
}

export function targetLabel(action: Action): string {
  if (action.target_id === null || action.target_id === undefined) return "";
  const el = getElementById(action.target_id);
  if (!el) return `#${action.target_id}`;
  const label =
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    (el as HTMLElement).innerText ||
    el.getAttribute("name") ||
    `#${action.target_id}`;
  return label.replace(/\s+/g, " ").trim().slice(0, 40);
}

function scrollTo(el: Element): void {
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

// React-controlled inputs ignore a plain value assignment, so use the
// prototype setter and dispatch the events React listens for.
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function execute(action: Action, overlay: Overlay): Promise<ExecResult> {
  const el = action.target_id !== null && action.target_id !== undefined ? getElementById(action.target_id) : null;

  switch (action.action) {
    case "highlight": {
      if (!el) return { outcome: "target not found on page", waitForUser: false, autoAfterMs: 400 };
      scrollTo(el);
      overlay.show(el, action.message);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        try {
          el.focus({ preventScroll: true });
        } catch {
          // ignore focus failures
        }
      }
      return { outcome: "highlighted, waiting for user", waitForUser: true };
    }
    case "explain": {
      overlay.clear();
      return { outcome: action.policy_blocked ? "policy blocked, explained instead" : "explained, waiting for user", waitForUser: true };
    }
    case "scroll": {
      overlay.clear();
      if (el) scrollTo(el);
      else window.scrollBy({ top: window.innerHeight * 0.6, behavior: "smooth" });
      return { outcome: el ? "scrolled to target" : "scrolled down", waitForUser: false, autoAfterMs: 700 };
    }
    case "ask": {
      overlay.clear();
      return { outcome: "asked, waiting for answer", waitForUser: true };
    }
    case "wait": {
      return { outcome: "waited for page", waitForUser: false, autoAfterMs: 1500 };
    }
    case "done": {
      overlay.clear();
      return { outcome: "goal complete", waitForUser: true, finished: true };
    }
    case "fill": {
      if (!el) return { outcome: "target not found on page", waitForUser: false, autoAfterMs: 400 };
      if (isSensitive(el)) return { outcome: "refused: sensitive field", waitForUser: true };
      scrollTo(el);
      overlay.show(el, action.message);
      const value = action.value ?? "";
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox" || el.type === "radio") {
          el.click();
          return { outcome: `selected "${targetLabel(action)}"`, waitForUser: false, settle: true };
        }
        setNativeValue(el, value);
        return { outcome: `filled "${targetLabel(action)}"`, waitForUser: false, settle: true };
      }
      if (el instanceof HTMLTextAreaElement) {
        setNativeValue(el, value);
        return { outcome: `filled "${targetLabel(action)}"`, waitForUser: false, settle: true };
      }
      if (el instanceof HTMLSelectElement) {
        const match = Array.from(el.options).find(
          (o) => o.value === value || o.text.trim().toLowerCase() === value.trim().toLowerCase(),
        );
        if (!match) return { outcome: `no option matching "${value}"`, waitForUser: false, autoAfterMs: 400 };
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        if (setter) setter.call(el, match.value);
        else el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { outcome: `selected "${match.text}"`, waitForUser: false, settle: true };
      }
      return { outcome: "target is not fillable", waitForUser: false, autoAfterMs: 400 };
    }
    case "click": {
      if (!el) return { outcome: "target not found on page", waitForUser: false, autoAfterMs: 400 };
      if (isSensitive(el)) return { outcome: "refused: sensitive element", waitForUser: true };
      scrollTo(el);
      overlay.show(el, action.message);
      (el as HTMLElement).click();
      return { outcome: `clicked "${targetLabel(action)}"`, waitForUser: false, settle: true };
    }
    default:
      return { outcome: "unknown action", waitForUser: true };
  }
}
