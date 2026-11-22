import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Layers3,
  Radio,
} from "lucide-react";
import "./landing.css";

const steps = [
  {
    title: "Find the right service",
    description: "Browse the catalogue and check eligibility, quantities, and pricing before you book.",
    icon: Layers3,
  },
  {
    title: "Plan your campaign",
    description: "Choose a schedule for eligible services and review the quote before submitting.",
    icon: CalendarDays,
  },
  {
    title: "Follow your orders",
    description: "Check progress, review payment history, and reach support from your workspace.",
    icon: ChartNoAxesCombined,
  },
];

export function Landing({
  browse,
  signIn,
  register,
}: {
  browse: () => void;
  signIn: () => void;
  register: () => void;
}) {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <a className="landing-brand" href="/" aria-label="VOXX home">
            <img src="/brand/voxx-wordmark.svg" alt="" width="125" height="34" />
          </a>
          <nav aria-label="Main navigation">
            <button onClick={browse}>Services</button>
            <a href="#how-it-works">How it works</a>
          </nav>
          <button className="landing-sign-in" onClick={signIn}>Sign in <ArrowUpRight size={15} /></button>
        </div>
      </header>
      <main className="landing-container landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-intro">
            <p className="landing-kicker"><Radio size={16} /> Campaign management</p>
            <h1 id="landing-title">Run campaigns.<br /><span>Track the results.</span></h1>
            <p className="landing-description">
              Browse marketing services, plan your campaigns, and follow every order from one workspace.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={register}>Create an account <ArrowRight size={17} /></button>
              <button className="landing-secondary" onClick={browse}>Browse services</button>
            </div>
          </div>
          <div className="landing-visual">
            <div className="landing-orbit" aria-hidden="true"><i /><i /></div>
            <div className="landing-preview">
              <div className="landing-preview-head">
                <span>Campaign overview</span>
                <small>Illustrative preview</small>
              </div>
              <div className="landing-chart">
                <span>Order progress</span>
                <div className="landing-chart-bars" aria-hidden="true">
                  {[18, 25, 23, 37, 35, 48, 44, 53, 64, 61, 77, 88].map((height, index) => (
                    <span key={index} style={{ height: height + "%" }} />
                  ))}
                </div>
              </div>
              <div className="landing-preview-status" aria-label="Example order stages">
                <span>Queued</span><span>In progress</span><span>Completed</span>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-workflow" id="how-it-works">
          <h2>How it works</h2>
          <div className="landing-steps">
            {steps.map(({ title, description, icon: Icon }) => (
              <article key={title}>
                <Icon size={21} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <span>© {new Date().getFullYear()} VOXX</span>
        <button onClick={signIn}>Customer sign in <ArrowUpRight size={14} /></button>
      </footer>
    </div>
  );
}
