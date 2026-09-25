import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { mountOnboarding, unmountOnboarding } from "../../widget/mount";
import { Donate } from "./Donate";
import "./canopy.css";

const PROGRAMS = [
  {
    id: "urban-canopy",
    name: "Urban Canopy",
    short: "Street trees for neighborhoods that have the least shade. We plant, water and prune for three years so the trees actually survive.",
    long:
      "Cities are hotter where trees are missing, and those are usually the neighborhoods with the least money to fix it. Urban Canopy works with city forestry departments to plant street trees on blocks with under ten percent canopy cover, then pays local crews to water and prune them for three years. A thirty dollar gift covers one tree's first-year care.",
  },
  {
    id: "reforestation",
    name: "Reforestation",
    short: "Native seedlings for burned and logged hillsides in the Sierra foothills, planted by seasonal crews and tracked for five years.",
    long:
      "After a fire, a hillside has about two growing seasons before invasive grasses take over. Reforestation crews plant native oaks, pines and willows in those windows and return each spring to replace what did not make it. We publish survival rates for every site.",
  },
  {
    id: "school-groves",
    name: "School Groves",
    short: "Small orchards and shade groves on schoolyards, planted with the students who will eat from and sit under them.",
    long:
      "Every School Grove is planted by the students themselves during a science block, with a teacher kit that turns the grove into a year-long lesson on water, soil and shade. Schools apply in the fall; groves go in during spring break.",
  },
];

function Layout() {
  useEffect(() => {
    mountOnboarding("canopy");
    return () => unmountOnboarding();
  }, []);

  return (
    <div className="cc-site">
      <nav className="cc-nav" aria-label="Main">
        <Link to="/canopy" className="cc-wordmark">
          Canopy Collective
        </Link>
        <div className="cc-links">
          <NavLink to="/canopy/programs">Programs</NavLink>
          <NavLink to="/canopy/volunteer">Volunteer</NavLink>
          <a href="#shop" onClick={(e) => e.preventDefault()}>
            Shop
          </a>
          <NavLink to="/canopy/donate" className="cc-nav-donate">
            Donate
          </NavLink>
        </div>
      </nav>
      <main className="cc-main">
        <Outlet />
      </main>
      <footer className="cc-footer">
        <div className="cc-footer-inner">
          <div>
            <div className="cc-footer-title">Stay in the loop</div>
            <p>One email a month about planting days and how the trees are doing.</p>
            <NewsletterForm />
          </div>
          <div className="cc-footer-meta">
            <div>Canopy Collective is a fictional 501(c)(3) built for a product demo.</div>
            <div>No real donations are processed.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) setSent(true);
  }
  if (sent) return <div className="cc-inline-ok">You are on the list.</div>;
  return (
    <form className="cc-newsletter" onSubmit={submit}>
      <label htmlFor="cc-news-email" className="cc-visually-hidden">
        Email for newsletter
      </label>
      <input id="cc-news-email" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Subscribe</button>
    </form>
  );
}

function Home() {
  return (
    <>
      <section className="cc-hero">
        <h1>Shade is a public good. We plant it.</h1>
        <p className="cc-lede">
          Canopy Collective plants and cares for trees where they are missing most: hot city blocks, burned hillsides
          and bare schoolyards. Every gift is tied to a program you choose.
        </p>
        <div className="cc-hero-actions">
          <Link to="/canopy/donate" className="cc-btn cc-btn-donate">
            Give to a program
          </Link>
          <Link to="/canopy/programs" className="cc-btn cc-btn-quiet">
            See the three programs
          </Link>
        </div>
      </section>

      <section className="cc-programs" aria-labelledby="cc-programs-h">
        <h2 id="cc-programs-h">Three programs, one job</h2>
        <div className="cc-program-grid">
          {PROGRAMS.map((p) => (
            <article key={p.id} className="cc-program">
              <h3>{p.name}</h3>
              <p>{p.short}</p>
              <Link to={`/canopy/donate?designation=${p.id}`}>Support {p.name}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="cc-how" aria-labelledby="cc-how-h">
        <h2 id="cc-how-h">How we work</h2>
        <p>
          Donations buy saplings, pay planting crews and fund three years of watering and pruning. Eighty-five percent of
          every dollar goes directly to programs; the rest covers staff, insurance and the trucks.
        </p>
        <p>
          We partner with city forestry departments rather than working around them, so every street tree we plant is
          on the city's own maintenance map. Schools apply for groves in the fall and we plant during spring break.
        </p>
        <p>
          You can give once or monthly, and you can designate your gift to a single program. Undesignated gifts go
          wherever the season needs them most, usually Reforestation in spring and Urban Canopy in fall.
        </p>
        <div className="cc-stat-row">
          <div className="cc-stat">
            <div className="cc-stat-n">12,400</div>
            <div className="cc-stat-l">trees in the ground since 2019</div>
          </div>
          <div className="cc-stat">
            <div className="cc-stat-n">91%</div>
            <div className="cc-stat-l">three-year survival on street trees</div>
          </div>
          <div className="cc-stat">
            <div className="cc-stat-n">38</div>
            <div className="cc-stat-l">school groves planted</div>
          </div>
        </div>
      </section>

      <section className="cc-events" aria-labelledby="cc-events-h">
        <h2 id="cc-events-h">Upcoming planting days</h2>
        <ul className="cc-event-list">
          <li>
            <span>Oct 11</span> Fruitvale street tree planting, Oakland
          </li>
          <li>
            <span>Oct 25</span> Post-fire seedling day, Nevada County
          </li>
          <li>
            <span>Nov 8</span> Longfellow Elementary grove, Berkeley
          </li>
        </ul>
        <Link to="/canopy/volunteer">Sign up to volunteer</Link>
      </section>
    </>
  );
}

function Programs() {
  return (
    <div className="cc-narrow">
      <h1>Programs</h1>
      {PROGRAMS.map((p) => (
        <section key={p.id} className="cc-program-detail" aria-labelledby={`cc-${p.id}`}>
          <h2 id={`cc-${p.id}`}>{p.name}</h2>
          <p>{p.long}</p>
          <Link to={`/canopy/donate?designation=${p.id}`} className="cc-btn cc-btn-quiet">
            Support this program
          </Link>
        </section>
      ))}
    </div>
  );
}

function Volunteer() {
  const [form, setForm] = useState({ name: "", email: "", city: "", weekends: false, weekdays: false, schools: false });
  const [done, setDone] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.name.trim() && form.email.trim()) setDone(true);
  }

  return (
    <div className="cc-narrow">
      <h1>Volunteer</h1>
      <p>
        Planting days run four hours on a Saturday morning. We bring the trees, the tools and the coffee. You bring
        gloves and a water bottle.
      </p>
      {done ? (
        <div className="cc-confirm" data-pf-include>
          <h2>Thank you for volunteering</h2>
          <p>We sent a confirmation to {form.email}. Someone from the crew will reach out before the next planting day.</p>
        </div>
      ) : (
        <form className="cc-form" onSubmit={submit}>
          <label htmlFor="cc-vol-name">Full name</label>
          <input id="cc-vol-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label htmlFor="cc-vol-email">Email</label>
          <input id="cc-vol-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label htmlFor="cc-vol-city">City</label>
          <input id="cc-vol-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <fieldset className="cc-fieldset">
            <legend>Availability</legend>
            <label>
              <input type="checkbox" checked={form.weekends} onChange={(e) => setForm({ ...form, weekends: e.target.checked })} /> Weekend
              planting days
            </label>
            <label>
              <input type="checkbox" checked={form.weekdays} onChange={(e) => setForm({ ...form, weekdays: e.target.checked })} /> Weekday
              watering runs
            </label>
            <label>
              <input type="checkbox" checked={form.schools} onChange={(e) => setForm({ ...form, schools: e.target.checked })} /> School grove
              days
            </label>
          </fieldset>
          <button type="submit" className="cc-btn cc-btn-donate">
            Sign me up
          </button>
        </form>
      )}
    </div>
  );
}

interface Receipt {
  number: string;
  amount: number;
  frequency: string;
  designation: string;
  name: string;
}

function Thanks() {
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("canopy_receipt");
    if (!raw) {
      navigate("/canopy/donate", { replace: true });
      return;
    }
    setReceipt(JSON.parse(raw) as Receipt);
  }, [navigate]);
  if (!receipt) return null;
  const designation = PROGRAMS.find((p) => p.id === receipt.designation)?.name ?? "General fund";
  return (
    <div className="cc-narrow">
      <div className="cc-confirm" data-pf-include>
        <h1>Thank you, {receipt.name.split(" ")[0]}.</h1>
        <p className="cc-receipt">Receipt number {receipt.number}</p>
        <p>
          Your {receipt.frequency === "monthly" ? "monthly" : "one-time"} gift of ${receipt.amount} is designated to {designation}.
          A receipt is on its way to your inbox.
        </p>
      </div>
      <p>
        <Link to="/canopy">Back to the home page</Link>
      </p>
    </div>
  );
}

export function CanopySite() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="programs" element={<Programs />} />
        <Route path="donate" element={<Donate programs={PROGRAMS} />} />
        <Route path="thanks" element={<Thanks />} />
        <Route path="volunteer" element={<Volunteer />} />
      </Route>
    </Routes>
  );
}
