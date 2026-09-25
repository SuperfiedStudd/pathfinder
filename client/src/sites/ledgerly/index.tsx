import { createContext, useContext, useEffect, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { mountOnboarding, unmountOnboarding } from "../../widget/mount";
import "./ledgerly.css";

// State ---------------------------------------------------------------

interface SetupState {
  org: { name: string; industry: string; size: string };
  pipeline: { template: string; stages: string[] };
  contacts: { method: "" | "csv" | "google" | "skip"; file: string };
  integrations: { gmail: boolean; calendar: boolean; slack: boolean };
  members: { emails: string[]; skipped: boolean };
  completed: { org: boolean; pipeline: boolean; contacts: boolean; integrations: boolean; members: boolean };
}

const INITIAL: SetupState = {
  org: { name: "", industry: "", size: "" },
  pipeline: { template: "", stages: [] },
  contacts: { method: "", file: "" },
  integrations: { gmail: false, calendar: false, slack: false },
  members: { emails: ["", "", ""], skipped: false },
  completed: { org: false, pipeline: false, contacts: false, integrations: false, members: false },
};

type Act =
  | { type: "org"; patch: Partial<SetupState["org"]> }
  | { type: "template"; template: string }
  | { type: "stages"; stages: string[] }
  | { type: "contacts"; method: SetupState["contacts"]["method"]; file?: string }
  | { type: "integration"; key: keyof SetupState["integrations"]; value: boolean }
  | { type: "members"; emails: string[] }
  | { type: "complete"; key: keyof SetupState["completed"]; value?: boolean }
  | { type: "skipMembers" }
  | { type: "reset" };

export const TEMPLATES: Record<string, { label: string; blurb: string; stages: string[] }> = {
  sales: { label: "Sales", blurb: "Leads to closed deals. Good for products or services with a quote step.", stages: ["Lead", "Qualified", "Proposal", "Negotiation", "Won"] },
  realestate: { label: "Real estate", blurb: "Inquiries through showings, offers and escrow.", stages: ["Inquiry", "Showing", "Offer", "Escrow", "Closed"] },
  agency: { label: "Agency", blurb: "Client briefs through pitch, contract, delivery and retainer.", stages: ["Brief", "Pitch", "Contract", "Delivery", "Retainer"] },
  recruiting: { label: "Recruiting", blurb: "Candidates from sourcing to hire.", stages: ["Sourced", "Screen", "Interview", "Offer", "Hired"] },
  custom: { label: "Custom", blurb: "Start with three stages and shape it yourself.", stages: ["New", "In progress", "Done"] },
};

function reducer(state: SetupState, act: Act): SetupState {
  switch (act.type) {
    case "org":
      return { ...state, org: { ...state.org, ...act.patch } };
    case "template":
      return { ...state, pipeline: { template: act.template, stages: [...TEMPLATES[act.template].stages] } };
    case "stages":
      return { ...state, pipeline: { ...state.pipeline, stages: act.stages } };
    case "contacts":
      return { ...state, contacts: { method: act.method, file: act.file ?? "" }, completed: { ...state.completed, contacts: act.method !== "" } };
    case "integration":
      return { ...state, integrations: { ...state.integrations, [act.key]: act.value } };
    case "members":
      return { ...state, members: { ...state.members, emails: act.emails } };
    case "skipMembers":
      return { ...state, members: { ...state.members, skipped: true }, completed: { ...state.completed, members: true } };
    case "complete":
      return { ...state, completed: { ...state.completed, [act.key]: act.value ?? true } };
    case "reset":
      return INITIAL;
    default:
      return state;
  }
}

const STORAGE_KEY = "ledgerly_setup";

function load(): SetupState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return { ...INITIAL, ...(JSON.parse(raw) as SetupState) };
  } catch {
    // ignore corrupt storage
  }
  return INITIAL;
}

const Ctx = createContext<{ state: SetupState; dispatch: Dispatch<Act> } | null>(null);

function useSetup() {
  const v = useContext(Ctx);
  if (!v) throw new Error("setup context missing");
  return v;
}

function Provider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

// Layout --------------------------------------------------------------

const STEPS = [
  { n: 1, key: "org", label: "Organization" },
  { n: 2, key: "pipeline", label: "Pipeline" },
  { n: 3, key: "contacts", label: "Contacts" },
  { n: 4, key: "integrations", label: "Integrations" },
  { n: 5, key: "members", label: "Members" },
] as const;

function Layout() {
  const { state } = useSetup();
  const [params] = useSearchParams();
  const current = Number(params.get("step") || 0);

  useEffect(() => {
    mountOnboarding("ledgerly");
    return () => unmountOnboarding();
  }, []);

  return (
    <div className="lg-shell">
      <aside className="lg-sidebar">
        <Link to="/ledgerly/dashboard" className="lg-logo">
          Ledgerly
        </Link>
        <div className="lg-side-title">Workspace setup</div>
        <ol className="lg-stepper">
          {STEPS.map((s) => {
            const done = state.completed[s.key];
            const active = current === s.n;
            return (
              <li key={s.key} className={`lg-step ${active ? "lg-step-active" : ""} ${done ? "lg-step-done" : ""}`}>
                <Link to={`/ledgerly/setup?step=${s.n}`}>
                  <span className="lg-step-n">{done ? "✓" : s.n}</span>
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ol>
        <Link to="/ledgerly/dashboard" className="lg-side-link">
          Dashboard
        </Link>
      </aside>
      <main className="lg-main">
        <Outlet />
      </main>
    </div>
  );
}

// Wizard --------------------------------------------------------------

function Setup() {
  const [params] = useSearchParams();
  const step = Number(params.get("step") || 1);
  if (step === 1) return <OrgStep />;
  if (step === 2) return <PipelineStep />;
  if (step === 3) return <ContactsStep />;
  if (step === 4) return <IntegrationsStep />;
  if (step === 5) return <MembersStep />;
  return <Navigate to="/ledgerly/setup?step=1" replace />;
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <header className="lg-step-header">
      <div className="lg-step-count">Step {n} of 5</div>
      <h1>{title}</h1>
      <p>{hint}</p>
    </header>
  );
}

function OrgStep() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const ready = state.org.name.trim() && state.org.industry && state.org.size;
  return (
    <section className="lg-card">
      <StepHeader n={1} title="Tell us about your organization" hint="This names your workspace and tunes the defaults on the next steps." />
      <div className="lg-field">
        <label htmlFor="lg-org-name">Organization name</label>
        <input id="lg-org-name" value={state.org.name} onChange={(e) => dispatch({ type: "org", patch: { name: e.target.value } })} placeholder="Acme Roasters" />
      </div>
      <div className="lg-field">
        <label htmlFor="lg-industry">Industry</label>
        <select id="lg-industry" value={state.org.industry} onChange={(e) => dispatch({ type: "org", patch: { industry: e.target.value } })}>
          <option value="">Choose one</option>
          {["Retail", "Coffee and food", "Real estate", "Agency", "Recruiting", "Consulting", "SaaS", "Other"].map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="lg-fieldset">
        <legend>How many people will use this?</legend>
        {["Just me", "2 to 10", "11 to 50", "51+"].map((s) => (
          <label key={s} className="lg-radio">
            <input type="radio" name="size" checked={state.org.size === s} onChange={() => dispatch({ type: "org", patch: { size: s } })} />
            {s}
          </label>
        ))}
      </fieldset>
      <div className="lg-actions">
        <button
          className="lg-btn lg-primary"
          disabled={!ready}
          onClick={() => {
            dispatch({ type: "complete", key: "org" });
            navigate("/ledgerly/setup?step=2");
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function PipelineStep() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [newStage, setNewStage] = useState("");
  const chosen = state.pipeline.template;
  return (
    <section className="lg-card">
      <StepHeader n={2} title="Pick a pipeline template" hint="A pipeline is the set of stages a deal moves through. You can rename stages later." />
      <div className="lg-templates" role="radiogroup" aria-label="Pipeline template">
        {Object.entries(TEMPLATES).map(([key, t]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={chosen === key}
            className={`lg-template ${chosen === key ? "lg-template-on" : ""}`}
            onClick={() => dispatch({ type: "template", template: key })}
          >
            <span className="lg-template-name">{t.label}</span>
            <span className="lg-template-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="lg-stages">
          <h2>Stages</h2>
          <ul>
            {state.pipeline.stages.map((s, i) => (
              <li key={`${s}-${i}`}>
                <input
                  aria-label={`Stage ${i + 1} name`}
                  value={s}
                  onChange={(e) => {
                    const next = [...state.pipeline.stages];
                    next[i] = e.target.value;
                    dispatch({ type: "stages", stages: next });
                  }}
                />
                <button
                  type="button"
                  className="lg-btn lg-small"
                  aria-label={`Remove stage ${s}`}
                  onClick={() => dispatch({ type: "stages", stages: state.pipeline.stages.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="lg-row">
            <input aria-label="New stage name" placeholder="Add a stage" value={newStage} onChange={(e) => setNewStage(e.target.value)} />
            <button
              type="button"
              className="lg-btn"
              disabled={!newStage.trim()}
              onClick={() => {
                dispatch({ type: "stages", stages: [...state.pipeline.stages, newStage.trim()] });
                setNewStage("");
              }}
            >
              Add stage
            </button>
          </div>
        </div>
      )}
      <div className="lg-actions">
        <button className="lg-btn" onClick={() => navigate("/ledgerly/setup?step=1")}>
          Back
        </button>
        <button
          className="lg-btn lg-primary"
          disabled={!chosen || state.pipeline.stages.length === 0}
          onClick={() => {
            dispatch({ type: "complete", key: "pipeline" });
            navigate("/ledgerly/setup?step=3");
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function ContactsStep() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const m = state.contacts.method;
  return (
    <section className="lg-card">
      <StepHeader n={3} title="Bring in your contacts" hint="Optional. You can import later from Settings." />
      <div className="lg-options">
        <div className={`lg-option ${m === "csv" ? "lg-option-on" : ""}`}>
          <h2>Upload a CSV</h2>
          <p>Any spreadsheet export works. We map the columns for you.</p>
          <label htmlFor="lg-csv" className="lg-btn">
            Choose file
          </label>
          <input
            id="lg-csv"
            type="file"
            className="lg-file"
            onChange={(e) => dispatch({ type: "contacts", method: "csv", file: e.target.files?.[0]?.name ?? "" })}
          />
          {m === "csv" && state.contacts.file && <div className="lg-ok">Selected {state.contacts.file}</div>}
        </div>
        <div className={`lg-option ${m === "google" ? "lg-option-on" : ""}`}>
          <h2>Connect Google Contacts</h2>
          <p>Pulls names and emails from your Google account.</p>
          <button
            type="button"
            className="lg-btn"
            disabled={connecting || m === "google"}
            onClick={() => {
              setConnecting(true);
              window.setTimeout(() => {
                setConnecting(false);
                dispatch({ type: "contacts", method: "google" });
              }, 1000);
            }}
          >
            {m === "google" ? "Connected" : connecting ? "Connecting" : "Connect Google Contacts"}
          </button>
        </div>
        <div className={`lg-option ${m === "skip" ? "lg-option-on" : ""}`}>
          <h2>Start empty</h2>
          <p>Add contacts by hand as deals come in.</p>
          <button type="button" className="lg-btn" onClick={() => dispatch({ type: "contacts", method: "skip" })}>
            {m === "skip" ? "Skipping import" : "Skip for now"}
          </button>
        </div>
      </div>
      <div className="lg-actions">
        <button className="lg-btn" onClick={() => navigate("/ledgerly/setup?step=2")}>
          Back
        </button>
        <button className="lg-btn lg-primary" disabled={!m} onClick={() => navigate("/ledgerly/setup?step=4")}>
          Continue
        </button>
      </div>
    </section>
  );
}

function IntegrationRow({ name, blurb, on, onConnect }: { name: string; blurb: string; on: boolean; onConnect: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="lg-integration">
      <div>
        <div className="lg-integration-name">{name}</div>
        <div className="lg-integration-blurb">{blurb}</div>
      </div>
      <button
        type="button"
        className={`lg-btn ${on ? "lg-connected" : ""}`}
        disabled={busy || on}
        onClick={() => {
          setBusy(true);
          window.setTimeout(() => {
            setBusy(false);
            onConnect();
          }, 1000);
        }}
      >
        {on ? "Connected" : busy ? "Connecting" : `Connect ${name}`}
      </button>
    </div>
  );
}

function IntegrationsStep() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const any = state.integrations.gmail || state.integrations.calendar || state.integrations.slack;
  return (
    <section className="lg-card">
      <StepHeader n={4} title="Connect your tools" hint="Connect at least one so activity shows up on your deals. Others can wait." />
      <div className="lg-integrations">
        <IntegrationRow name="Gmail" blurb="Logs emails with contacts on their deal." on={state.integrations.gmail} onConnect={() => dispatch({ type: "integration", key: "gmail", value: true })} />
        <IntegrationRow name="Calendar" blurb="Shows meetings on the deal timeline." on={state.integrations.calendar} onConnect={() => dispatch({ type: "integration", key: "calendar", value: true })} />
        <IntegrationRow name="Slack" blurb="Posts stage changes to a channel." on={state.integrations.slack} onConnect={() => dispatch({ type: "integration", key: "slack", value: true })} />
      </div>
      <div className="lg-actions">
        <button className="lg-btn" onClick={() => navigate("/ledgerly/setup?step=3")}>
          Back
        </button>
        <button
          className="lg-btn lg-primary"
          disabled={!any}
          onClick={() => {
            dispatch({ type: "complete", key: "integrations" });
            navigate("/ledgerly/setup?step=5");
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function MembersStep() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const filled = state.members.emails.some((e) => e.trim());
  return (
    <section className="lg-card">
      <StepHeader n={5} title="Invite members" hint="Optional. Members get their own login and see the same pipeline." />
      {state.members.emails.map((e, i) => (
        <div className="lg-field" key={i}>
          <label htmlFor={`lg-member-${i}`}>Member email {i + 1}</label>
          <input
            id={`lg-member-${i}`}
            type="email"
            value={e}
            onChange={(ev) => {
              const next = [...state.members.emails];
              next[i] = ev.target.value;
              dispatch({ type: "members", emails: next });
            }}
          />
        </div>
      ))}
      <div className="lg-actions">
        <button className="lg-btn" onClick={() => navigate("/ledgerly/setup?step=4")}>
          Back
        </button>
        <button
          className="lg-btn"
          onClick={() => {
            dispatch({ type: "skipMembers" });
            navigate("/ledgerly/dashboard");
          }}
        >
          Skip
        </button>
        <button
          className="lg-btn lg-primary"
          disabled={!filled}
          onClick={() => {
            dispatch({ type: "complete", key: "members" });
            navigate("/ledgerly/dashboard");
          }}
        >
          Send invites
        </button>
      </div>
    </section>
  );
}

// Dashboard -----------------------------------------------------------

function Dashboard() {
  const { state, dispatch } = useSetup();
  const c = state.completed;
  const ready = c.org && c.pipeline && c.integrations;
  const items: { key: keyof SetupState["completed"]; label: string; step: number; required: boolean }[] = [
    { key: "org", label: "Organization profile", step: 1, required: true },
    { key: "pipeline", label: "Pipeline template", step: 2, required: true },
    { key: "contacts", label: "Contacts imported", step: 3, required: false },
    { key: "integrations", label: "At least one integration", step: 4, required: true },
    { key: "members", label: "Members invited", step: 5, required: false },
  ];
  return (
    <section className="lg-card">
      <header className="lg-step-header">
        <h1>{state.org.name ? `${state.org.name} workspace` : "Your workspace"}</h1>
        <p>Finish the required items and your pipeline goes live.</p>
      </header>
      {ready && (
        <div className="lg-banner" data-pf-include>
          Workspace ready. Your {TEMPLATES[state.pipeline.template]?.label ?? ""} pipeline is live with {state.pipeline.stages.length} stages.
        </div>
      )}
      <ul className="lg-checklist">
        {items.map((it) => (
          <li key={it.key} className={c[it.key] ? "lg-check-done" : ""}>
            <span className="lg-check-mark">{c[it.key] ? "✓" : ""}</span>
            <span className="lg-check-label">
              {it.label}
              {!it.required && <span className="lg-optional"> (optional)</span>}
            </span>
            <Link to={`/ledgerly/setup?step=${it.step}`}>{c[it.key] ? "Edit" : "Set up"}</Link>
          </li>
        ))}
      </ul>
      <div className="lg-actions">
        <button className="lg-btn" onClick={() => dispatch({ type: "reset" })}>
          Reset setup
        </button>
      </div>
    </section>
  );
}

export function LedgerlySite() {
  return (
    <Provider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/ledgerly/setup?step=1" replace />} />
          <Route path="setup" element={<Setup />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </Provider>
  );
}
