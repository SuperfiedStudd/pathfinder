import type { Action, DecideRequest, DecideResponse, Mode, RecentAction, TranscriptTurn } from "@shared/schema";
import type { SiteManifest } from "@shared/manifests";
import { validateAction, effectiveMode } from "@shared/policy";
import { snapshot, getElementById, CANDIDATE_SELECTOR, resetSnapshotMemory } from "./extract";
import { execute, targetLabel } from "./actions";
import type { Overlay } from "./overlay";

export type LoopState =
  | "idle"
  | "thinking"
  | "acting"
  | "waiting_for_user"
  | "awaiting_confirm"
  | "finished"
  | "stopped"
  | "error";

export interface ChatMessage {
  id: number;
  role: "user" | "agent" | "system";
  text: string;
  options?: string[];
  blocked?: boolean;
}

export interface AuditEntry {
  at: number;
  action: string;
  target: string;
  value?: string;
  outcome: string;
}

export interface LoopView {
  state: LoopState;
  mode: Mode;
  goal: string;
  messages: ChatMessage[];
  pendingConfirm: Action | null;
  allowAll: boolean;
  lastPageModel: string;
  lastAction: Action | null;
  lastLatencyMs: number;
  lastModel: string;
  steps: number;
  audit: AuditEntry[];
  error: string;
}

const MAX_STEPS = 30;
const MUTATION_DEBOUNCE_MS = 700;
const MIN_GAP_AFTER_STEP_MS = 1200;
const SETTLE_QUIET_MS = 500;
const SETTLE_MAX_MS = 3000;

type Listener = (view: LoopView) => void;

function dbg(...args: unknown[]): void {
  if ((window as Window & { __pfDebug?: boolean }).__pfDebug) console.log("[pathfinder]", ...args);
}

export class OnboardingLoop {
  private view: LoopView;
  private listeners = new Set<Listener>();
  private transcript: TranscriptTurn[] = [];
  private recent: RecentAction[] = [];
  private msgId = 1;
  private stepInFlight = false;
  private lastStepEnd = 0;
  private mutationTimer: number | null = null;
  private observer: MutationObserver | null = null;
  private repeatKey = "";
  private repeatCount = 0;
  private settleResolver: (() => void) | null = null;
  private settleFinish: (() => void) | null = null;
  private pendingChange = false;
  private destroyed = false;
  private navigateHandler: (() => void) | null = null;
  private popstateHandler: (() => void) | null = null;
  private changeHandler: ((ev: Event) => void) | null = null;

  constructor(
    public readonly siteId: string,
    public readonly manifest: SiteManifest,
    private readonly overlay: Overlay,
    private readonly widgetRoot: HTMLElement,
  ) {
    this.view = {
      state: "idle",
      mode: manifest.policy.defaultMode,
      goal: "",
      messages: [
        {
          id: 0,
          role: "agent",
          text: `Hi. Tell me what you are trying to get done on ${manifest.siteName} and I will show you where to go, one step at a time.`,
        },
      ],
      pendingConfirm: null,
      allowAll: false,
      lastPageModel: "",
      lastAction: null,
      lastLatencyMs: 0,
      lastModel: "",
      steps: 0,
      audit: [],
      error: "",
    };
    this.installTriggers();
  }

  getView(): LoopView {
    return this.view;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.view);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<LoopView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn(this.view);
  }

  private say(role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): void {
    const msg: ChatMessage = { id: this.msgId++, role, text, ...extra };
    this.update({ messages: [...this.view.messages, msg] });
    if (role === "user") this.transcript.push({ role: "user", text });
    if (role === "agent") this.transcript.push({ role: "agent", text });
  }

  // Public controls -------------------------------------------------------

  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.say("user", trimmed);
    const st = this.view.state;
    if (st === "idle" || st === "finished" || st === "stopped" || st === "error") {
      this.transcript = this.transcript.slice(-10);
      this.recent = [];
      this.repeatKey = "";
      this.repeatCount = 0;
      resetSnapshotMemory();
      this.update({ goal: trimmed, steps: 0, error: "" });
      void this.step("new goal");
      return;
    }
    if (st === "awaiting_confirm") return;
    void this.step("user replied");
  }

  next(): void {
    if (this.view.state !== "waiting_for_user") return;
    this.pushOutcome("user pressed Done, what's next");
    void this.step("user pressed next");
  }

  stop(): void {
    this.overlay.clear();
    this.update({ state: "stopped", pendingConfirm: null });
    this.say("system", "Stopped. Send a new message whenever you want to continue.");
  }

  setMode(mode: Mode): void {
    const eff = effectiveMode(mode, this.manifest);
    this.update({ mode: eff });
  }

  setAllowAll(value: boolean): void {
    this.update({ allowAll: value });
  }

  confirm(decision: "allow" | "skip" | "edit", value?: string): void {
    const pending = this.view.pendingConfirm;
    if (!pending) return;
    this.update({ pendingConfirm: null });
    if (decision === "skip") {
      this.pushOutcome("user skipped this action", pending);
      this.say("system", `Skipped: ${describe(pending)}.`);
      void this.step("user skipped");
      return;
    }
    const toRun = decision === "edit" && value !== undefined ? { ...pending, value } : pending;
    void this.runAction(toRun);
  }

  // Core loop -------------------------------------------------------------

  private pushOutcome(outcome: string, action: Action | null = this.view.lastAction): void {
    if (!action) return;
    const last = this.recent[this.recent.length - 1];
    if (last && last.action === action.action && last.target === targetLabel(action)) {
      last.outcome = outcome;
    } else {
      this.recent.push({ action: action.action, target: targetLabel(action), outcome });
    }
    this.recent = this.recent.slice(-6);
  }

  private async step(reason: string): Promise<void> {
    if (this.destroyed) return;
    dbg("step", reason, "inFlight", this.stepInFlight, "steps", this.view.steps);
    if (this.stepInFlight) return;
    if (this.view.steps >= MAX_STEPS) {
      this.update({ state: "finished" });
      this.say("system", "That is thirty steps on one goal. Tell me where you got stuck and we can pick it up from there.");
      return;
    }
    this.stepInFlight = true;
    this.pendingChange = false;
    this.update({ state: "thinking", error: "" });

    try {
      const snap = snapshot();
      const body: DecideRequest = {
        siteId: this.siteId,
        mode: this.view.mode,
        goal: this.view.goal,
        transcript: this.transcript.slice(-10),
        recentActions: this.recent.slice(-6),
        pageModel: snap.text,
      };
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `decide failed (${res.status})`);
      }
      const data = (await res.json()) as DecideResponse;
      let action = validateAction(data.action, this.view.mode, this.manifest, snap.text);

      // Local loop breaker: three identical actions in a row become a question.
      const key = `${action.action}:${action.target_id ?? ""}`;
      this.repeatCount = key === this.repeatKey ? this.repeatCount + 1 : 1;
      this.repeatKey = key;
      if (this.repeatCount >= 3 && action.action !== "done") {
        action = {
          ...action,
          action: "ask",
          target_id: null,
          message: "I keep landing on the same step. What do you see on the page right now?",
          options: ["It moved on", "Nothing happened", "I got an error"],
        };
        this.repeatCount = 0;
      }

      this.update({
        lastPageModel: snap.text,
        lastAction: action,
        lastLatencyMs: data.latencyMs,
        lastModel: data.model,
        steps: this.view.steps + 1,
      });

      const needsConfirm = (action.action === "fill" || action.action === "click") && !this.view.allowAll;
      if (needsConfirm) {
        this.say("agent", action.message);
        this.update({ state: "awaiting_confirm", pendingConfirm: action });
        this.stepInFlight = false;
        this.lastStepEnd = Date.now();
        return;
      }
      this.stepInFlight = false;
      await this.runAction(action);
    } catch (err) {
      this.stepInFlight = false;
      this.lastStepEnd = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      this.overlay.clear();
      this.update({ state: "error", error: message });
      this.say("system", message === "rate limited" ? "The model is rate limited right now. Wait a few seconds and send your message again." : `Something went wrong: ${message}`);
    }
  }

  private async runAction(action: Action): Promise<void> {
    if (this.destroyed) return;
    if (this.stepInFlight) return;
    this.stepInFlight = true;
    this.update({ state: "acting" });
    if (!(action.action === "fill" || action.action === "click")) {
      this.say("agent", action.message, {
        options: action.action === "ask" ? action.options : undefined,
        blocked: action.policy_blocked,
      });
    }

    const result = await execute(action, this.overlay);
    if (action.action === "fill" || action.action === "click") {
      this.update({
        audit: [
          ...this.view.audit,
          { at: Date.now(), action: action.action, target: targetLabel(action), value: action.value ?? undefined, outcome: result.outcome },
        ],
      });
      this.say("system", `${action.action === "fill" ? "Filled" : "Clicked"} ${targetLabel(action)}: ${result.outcome}.`);
    }
    this.pushOutcome(result.outcome, action);
    this.stepInFlight = false;
    this.lastStepEnd = Date.now();

    if (result.finished) {
      this.update({ state: "finished" });
      return;
    }
    if (result.settle) {
      await this.waitForSettle();
      void this.step("after action");
      return;
    }
    if (result.autoAfterMs !== undefined) {
      this.update({ state: "acting" });
      window.setTimeout(() => void this.step("auto"), result.autoAfterMs);
      return;
    }
    this.update({ state: "waiting_for_user" });
    if (this.pendingChange) {
      this.pendingChange = false;
      this.onPageChanged("page changed during previous step");
    }
  }

  // Triggers --------------------------------------------------------------

  private installTriggers(): void {
    const w = window as Window & { __pfHistoryWrapped?: boolean };
    if (!w.__pfHistoryWrapped) {
      w.__pfHistoryWrapped = true;
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
        const r = origPush.apply(this, args);
        window.dispatchEvent(new Event("pf:navigate"));
        return r;
      };
      history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
        const r = origReplace.apply(this, args);
        window.dispatchEvent(new Event("pf:navigate"));
        return r;
      };
    }
    this.navigateHandler = () => this.onPageChanged("navigation");
    this.popstateHandler = () => this.onPageChanged("navigation");
    window.addEventListener("pf:navigate", this.navigateHandler);
    window.addEventListener("popstate", this.popstateHandler);

    this.changeHandler = (ev) => {
      const target = ev.target as Element | null;
      dbg("change event", target?.id, "current", (this.overlay.current() as HTMLElement | null)?.id, "same", this.overlay.current() === target);
      if (!target || this.widgetRoot.contains(target)) return;
      const current = this.overlay.current();
      if (current && (current === target || current.contains(target))) this.onPageChanged("field changed");
    };
    document.addEventListener("change", this.changeHandler, true);

    this.observer = new MutationObserver((records) => {
      if (this.destroyed) return;
      let significant = false;
      for (const rec of records) {
        if (this.widgetRoot.contains(rec.target)) continue;
        if (rec.type === "attributes") {
          significant = true;
          break;
        }
        const nodes = [...Array.from(rec.addedNodes), ...Array.from(rec.removedNodes)];
        for (const n of nodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches(CANDIDATE_SELECTOR) || n.querySelector(CANDIDATE_SELECTOR)) {
            significant = true;
            break;
          }
        }
        if (significant) break;
      }
      if (significant) this.notifySettle();
      if (significant) this.onPageChanged("page changed");
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled"],
    });
  }

  private onPageChanged(reason: string): void {
    if (this.destroyed) return;
    dbg("trigger", reason, "state", this.view.state, "gap", Date.now() - this.lastStepEnd);
    if (this.view.state !== "waiting_for_user") {
      // The page moved while the agent was deciding. Remember it so the
      // next waiting state re-evaluates instead of pointing at stale UI.
      if (this.view.state === "thinking" || this.view.state === "acting") this.pendingChange = true;
      return;
    }
    if (this.mutationTimer) window.clearTimeout(this.mutationTimer);
    const fire = () => {
      this.mutationTimer = null;
      dbg("debounce fired", reason, "state", this.view.state, "inFlight", this.stepInFlight);
      if (this.view.state !== "waiting_for_user") return;
      const sinceLast = Date.now() - this.lastStepEnd;
      if (sinceLast < MIN_GAP_AFTER_STEP_MS) {
        // Too soon after the last action: defer instead of dropping, a fast
        // user who clicks a radio right after the highlight still counts.
        dbg("trigger deferred", MIN_GAP_AFTER_STEP_MS - sinceLast);
        this.mutationTimer = window.setTimeout(fire, MIN_GAP_AFTER_STEP_MS - sinceLast);
        return;
      }
      const target = this.overlay.current();
      if (target && !target.isConnected) this.overlay.clear();
      this.pushOutcome(reason);
      void this.step(reason);
    };
    this.mutationTimer = window.setTimeout(fire, MUTATION_DEBOUNCE_MS);
  }

  private notifySettle(): void {
    if (this.settleResolver) this.settleResolver();
  }

  private waitForSettle(): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      let quiet: number | null = null;
      const finish = () => {
        this.settleResolver = null;
        this.settleFinish = null;
        if (quiet) window.clearTimeout(quiet);
        resolve();
      };
      const arm = () => {
        if (quiet) window.clearTimeout(quiet);
        if (Date.now() - started > SETTLE_MAX_MS) {
          finish();
          return;
        }
        quiet = window.setTimeout(finish, SETTLE_QUIET_MS);
      };
      this.settleResolver = arm;
      this.settleFinish = finish;
      arm();
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.navigateHandler) window.removeEventListener("pf:navigate", this.navigateHandler);
    if (this.popstateHandler) window.removeEventListener("popstate", this.popstateHandler);
    if (this.changeHandler) document.removeEventListener("change", this.changeHandler, true);
    this.observer?.disconnect();
    if (this.mutationTimer) window.clearTimeout(this.mutationTimer);
    this.mutationTimer = null;
    if (this.settleFinish) this.settleFinish();
    this.overlay.destroy();
    this.overlay.clear();
    this.listeners.clear();
  }
}

export function describe(action: Action): string {
  const label = targetLabel(action);
  if (action.action === "fill") return `fill ${label} with "${action.value ?? ""}"`;
  if (action.action === "click") return `press ${label}`;
  return action.action;
}

export function elementForAction(action: Action | null): Element | null {
  if (!action || action.target_id === null || action.target_id === undefined) return null;
  return getElementById(action.target_id);
}
