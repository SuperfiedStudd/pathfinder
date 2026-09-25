import { Link } from "react-router-dom";
import "./landing.css";

export const PRODUCT_NAME = "Pathfinder";

const SNIPPET = `<script src="https://cdn.pathfinder.dev/pf.js" data-site="your-site-id"></script>`;

export function Landing() {
  return (
    <div className="ld">
      <header className="ld-top">
        <div className="ld-name">{PRODUCT_NAME}</div>
        <a className="ld-top-link" href="https://github.com" target="_blank" rel="noreferrer">
          Source
        </a>
      </header>

      <section className="ld-hero">
        <h1>An onboarding guide that reads the page, not a script.</h1>
        <p>
          Tell it what you are trying to do. It looks at the live page, points at the next thing, waits for you, and
          looks again. Nothing to author, nothing to keep in sync when the UI changes.
        </p>
      </section>

      <section className="ld-demos" aria-label="Try it">
        <Link to="/canopy" className="ld-demo">
          <span className="ld-demo-kind">Nonprofit website</span>
          <span className="ld-demo-name">Canopy Collective</span>
          <span className="ld-demo-try">Try: "I want to support tree planting in cities but I do not know how this org works."</span>
        </Link>
        <Link to="/ledgerly" className="ld-demo ld-demo-dark">
          <span className="ld-demo-kind">SaaS setup wizard</span>
          <span className="ld-demo-name">Ledgerly CRM</span>
          <span className="ld-demo-try">Try: "Help me set up my workspace." Then switch on Do it for me.</span>
        </Link>
      </section>

      <section className="ld-how">
        <div className="ld-how-item">
          <h2>Reads the page</h2>
          <p>Buttons, fields, links and headings become a short text model. Card numbers and passwords are masked before anything leaves the browser.</p>
        </div>
        <div className="ld-how-item">
          <h2>Decides one step</h2>
          <p>Gemini gets the goal, the site's declared outcomes and the page model, and returns exactly one action.</p>
        </div>
        <div className="ld-how-item">
          <h2>Waits for you</h2>
          <p>It highlights, you act, the page changes, it looks again. Same agent on every site, no flows to write.</p>
        </div>
      </section>

      <section className="ld-install">
        <h2>Install is one tag</h2>
        <pre>{SNIPPET}</pre>
        <p>Plus a manifest that lists what a finished setup looks like. Outcomes, not steps.</p>
      </section>
    </div>
  );
}
