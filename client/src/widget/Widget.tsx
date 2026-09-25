import { useEffect, useRef, useState } from "react";
import type { OnboardingLoop, LoopView } from "./loop";
import { describe, elementForAction } from "./loop";

interface Props {
  loop: OnboardingLoop;
}

const STATE_LABEL: Record<LoopView["state"], string> = {
  idle: "Ready",
  thinking: "Looking at the page",
  acting: "Working",
  waiting_for_user: "Your turn",
  awaiting_confirm: "Needs your OK",
  finished: "Done",
  stopped: "Stopped",
  error: "Problem",
};

export function Widget({ loop }: Props) {
  const [view, setView] = useState<LoopView>(loop.getView());
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [consent, setConsent] = useState(false);
  const [editValue, setEditValue] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");
  const [docked, setDocked] = useState(false);

  useEffect(() => loop.subscribe(setView), [loop]);

  // On wide screens the panel docks as a sidebar and pushes the page over,
  // so it never covers the thing it is pointing at. Narrow screens keep the
  // floating panel.
  useEffect(() => {
    const apply = () => {
      const wide = window.innerWidth >= 960;
      const isDocked = open && wide;
      setDocked(isDocked);
      const root = document.documentElement;
      root.classList.toggle("pf-dock-right", isDocked && side === "right");
      root.classList.toggle("pf-dock-left", isDocked && side === "left");
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.documentElement.classList.remove("pf-dock-right", "pf-dock-left");
    };
  }, [open, side]);

  // Step out of the way: if the highlighted element sits under the panel,
  // move the panel to the other side of the screen.
  useEffect(() => {
    const el = elementForAction(view.lastAction);
    const card = cardRef.current;
    if (!el || !card || docked) return;
    const check = () => {
      const a = el.getBoundingClientRect();
      const b = card.getBoundingClientRect();
      const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (overlap) setSide((s) => (s === "right" ? "left" : "right"));
    };
    const t = window.setTimeout(check, 350);
    return () => window.clearTimeout(t);
  }, [view.lastAction, docked]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.messages.length, view.pendingConfirm, view.state]);

  const allowAssist = loop.manifest.policy.allowAssist;
  const busy = view.state === "thinking" || view.state === "acting";

  function submit() {
    if (!text.trim()) return;
    loop.send(text);
    setText("");
  }

  function requestMode(mode: "guide" | "assist") {
    if (mode === "guide") {
      loop.setMode("guide");
      setConsent(false);
      return;
    }
    if (!allowAssist) return;
    setConsent(true);
  }

  function acceptConsent() {
    loop.setMode("assist");
    setConsent(false);
  }

  const pending = view.pendingConfirm;

  return (
    <div className={`pf-panel pf-panel-${side} ${docked ? "pf-panel-docked" : ""} ${open ? "pf-open" : "pf-closed"}`} data-pf-widget-panel>
      {!docked && (
        <button className="pf-fab" onClick={() => setOpen(!open)} aria-label={open ? "Minimize guide" : "Open guide"}>
          {open ? "Hide guide" : "Need a hand?"}
        </button>
      )}

      {open && (
        <div className="pf-card" role="dialog" aria-label="Onboarding guide" ref={cardRef}>
          <header className="pf-header">
            <div>
              <div className="pf-title">Pathfinder</div>
              <div className="pf-subtitle">{loop.manifest.siteName}</div>
            </div>
            <div className="pf-row">
              <button className="pf-btn pf-small pf-ghost" onClick={() => setSide(side === "right" ? "left" : "right")} title="Move the panel to the other side">
                Move
              </button>
              {docked && (
                <button className="pf-btn pf-small pf-ghost" onClick={() => setOpen(false)} title="Hide the guide">
                  Hide
                </button>
              )}
            </div>
            <div className="pf-modes" role="group" aria-label="Mode">
              <button
                className={`pf-mode ${view.mode === "guide" ? "pf-mode-on" : ""}`}
                onClick={() => requestMode("guide")}
              >
                Guide
              </button>
              <button
                className={`pf-mode ${view.mode === "assist" ? "pf-mode-on" : ""}`}
                onClick={() => requestMode("assist")}
                disabled={!allowAssist}
                title={allowAssist ? "Let the guide fill fields and press buttons, with your OK" : "This site has not enabled assisted setup"}
              >
                Do it for me
              </button>
            </div>
          </header>

          {consent && (
            <div className="pf-consent">
              <p>
                With this on, the guide may fill fields and press buttons on this page. Sensitive fields such as card
                numbers are never touched. You will see every action before it runs.
              </p>
              <div className="pf-row">
                <button className="pf-btn pf-primary" onClick={acceptConsent}>
                  Turn on
                </button>
                <button className="pf-btn" onClick={() => setConsent(false)}>
                  Keep guiding only
                </button>
              </div>
            </div>
          )}

          <div className="pf-messages" ref={listRef}>
            {view.messages.map((m) => (
              <div key={m.id} className={`pf-msg pf-msg-${m.role} ${m.blocked ? "pf-msg-blocked" : ""}`}>
                <div className="pf-bubble">{m.text}</div>
                {m.options && m.options.length > 0 && m.id === view.messages[view.messages.length - 1]?.id && (
                  <div className="pf-chips">
                    {m.options.map((o) => (
                      <button key={o} className="pf-chip" onClick={() => loop.send(o)} disabled={busy}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {m.blocked && <div className="pf-blocked-note">Policy kept this to guidance only.</div>}
              </div>
            ))}
            {busy && (
              <div className="pf-msg pf-msg-agent">
                <div className="pf-bubble pf-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            {pending && (
              <div className="pf-confirm">
                <div className="pf-confirm-title">The guide wants to {describe(pending)}</div>
                {editValue !== null ? (
                  <div className="pf-row">
                    <input
                      className="pf-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      aria-label="Edited value"
                    />
                    <button
                      className="pf-btn pf-primary"
                      onClick={() => {
                        loop.confirm("edit", editValue);
                        setEditValue(null);
                      }}
                    >
                      Use this
                    </button>
                  </div>
                ) : (
                  <div className="pf-row">
                    <button className="pf-btn pf-primary" onClick={() => loop.confirm("allow")}>
                      Allow
                    </button>
                    {pending.action === "fill" && (
                      <button className="pf-btn" onClick={() => setEditValue(pending.value ?? "")}>
                        Edit
                      </button>
                    )}
                    <button className="pf-btn" onClick={() => loop.confirm("skip")}>
                      Skip
                    </button>
                  </div>
                )}
                <label className="pf-check">
                  <input type="checkbox" checked={view.allowAll} onChange={(e) => loop.setAllowAll(e.target.checked)} />
                  Allow all for this goal
                </label>
              </div>
            )}
          </div>

          <div className="pf-composer">
            <input
              className="pf-input"
              placeholder={view.state === "idle" ? "What are you trying to do?" : "Reply or ask something"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              disabled={busy || view.state === "awaiting_confirm"}
              aria-label="Message the guide"
            />
            <button className="pf-btn pf-primary" onClick={submit} disabled={busy || !text.trim()}>
              Send
            </button>
          </div>

          <div className="pf-toolbar">
            <span className={`pf-status pf-status-${view.state}`}>{STATE_LABEL[view.state]}</span>
            <div className="pf-row">
              <button className="pf-btn pf-small" onClick={() => loop.next()} disabled={view.state !== "waiting_for_user"}>
                Done, what's next
              </button>
              <button className="pf-btn pf-small" onClick={() => loop.stop()} disabled={view.state === "idle" || view.state === "stopped"}>
                Stop
              </button>
              <button className="pf-btn pf-small pf-ghost" onClick={() => setDrawer(!drawer)}>
                {drawer ? "Hide what the guide sees" : "What the guide sees"}
              </button>
            </div>
          </div>

          {drawer && (
            <div className="pf-drawer">
              <div className="pf-drawer-meta">
                <span>model: {view.lastModel || "none yet"}</span>
                <span>latency: {view.lastLatencyMs} ms</span>
                <span>steps: {view.steps}</span>
                {view.lastAction?.policy_blocked && <span className="pf-flag">policy blocked</span>}
              </div>
              <div className="pf-drawer-label">Last action</div>
              <pre className="pf-pre">{view.lastAction ? JSON.stringify(view.lastAction, null, 2) : "none yet"}</pre>
              <div className="pf-drawer-label">Page model sent (sensitive fields already masked)</div>
              <pre className="pf-pre pf-pre-tall">{view.lastPageModel || "none yet"}</pre>
              {view.audit.length > 0 && (
                <>
                  <div className="pf-drawer-label">Actions taken on the page</div>
                  <ul className="pf-audit">
                    {view.audit.map((a) => (
                      <li key={a.at}>
                        {a.action} {a.target}
                        {a.value ? ` = "${a.value}"` : ""}: {a.outcome}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
