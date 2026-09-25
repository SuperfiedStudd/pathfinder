import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

interface Program {
  id: string;
  name: string;
}

interface Props {
  programs: Program[];
}

const PRESETS = [25, 50, 100];

export function Donate({ programs }: Props) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initial = params.get("designation") ?? "general";

  const [preset, setPreset] = useState<number | null>(50);
  const [custom, setCustom] = useState("");
  const [frequency, setFrequency] = useState<"once" | "monthly">("once");
  const [designation, setDesignation] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");

  const amount = useMemo(() => {
    if (preset !== null) return preset;
    const n = Number(custom);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [preset, custom]);

  const ready = amount > 0 && name.trim() && email.trim() && card.trim() && expiry.trim() && cvc.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const number = `CC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    sessionStorage.setItem("canopy_receipt", JSON.stringify({ number, amount, frequency, designation, name }));
    navigate("/canopy/thanks");
  }

  return (
    <div className="cc-narrow">
      <h1>Give to a program</h1>
      <p>Choose an amount, pick where it goes, and we will send a receipt the moment it clears.</p>

      <form className="cc-form cc-donate" onSubmit={submit}>
        <fieldset className="cc-fieldset">
          <legend>Amount</legend>
          <div className="cc-chips" role="group" aria-label="Amount presets">
            {PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className={`cc-chip ${preset === v ? "cc-chip-on" : ""}`}
                aria-pressed={preset === v}
                onClick={() => {
                  setPreset(v);
                  setCustom("");
                }}
              >
                ${v}
              </button>
            ))}
          </div>
          <label htmlFor="cc-custom">Or enter another amount</label>
          <input
            id="cc-custom"
            inputMode="numeric"
            placeholder="Custom amount in dollars"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setPreset(null);
            }}
          />
        </fieldset>

        <fieldset className="cc-fieldset">
          <legend>Frequency</legend>
          <label>
            <input type="radio" name="frequency" checked={frequency === "once"} onChange={() => setFrequency("once")} /> One-time
          </label>
          <label>
            <input type="radio" name="frequency" checked={frequency === "monthly"} onChange={() => setFrequency("monthly")} /> Monthly
          </label>
        </fieldset>

        <label htmlFor="cc-designation">Designate this gift to</label>
        <select id="cc-designation" value={designation} onChange={(e) => setDesignation(e.target.value)}>
          <option value="general">General fund</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label htmlFor="cc-name">Your name</label>
        <input id="cc-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />

        <label htmlFor="cc-email">Email for the receipt</label>
        <input id="cc-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <div className="cc-card" data-pf-sensitive>
          <div className="cc-card-title">Payment</div>
          <label htmlFor="cc-card">Card number</label>
          <input id="cc-card" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} required />
          <div className="cc-two">
            <div>
              <label htmlFor="cc-expiry">Expiry</label>
              <input id="cc-expiry" placeholder="MM/YY" autoComplete="cc-exp" value={expiry} onChange={(e) => setExpiry(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="cc-cvc">CVC</label>
              <input id="cc-cvc" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} required />
            </div>
          </div>
          <p className="cc-card-note">This is a demo. Type anything; nothing is charged.</p>
        </div>

        <button type="submit" className="cc-btn cc-btn-donate cc-btn-wide" disabled={!ready}>
          Donate {amount > 0 ? `$${amount}` : ""} {frequency === "monthly" ? "monthly" : "now"}
        </button>
      </form>
    </div>
  );
}
