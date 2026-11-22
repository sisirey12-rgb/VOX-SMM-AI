import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Layers3,
  Radio,
} from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";
import { db, type Catalogue } from "./catalogue";
import "./landing.css";

const steps = [
  {
    title: "Find the right service",
    description: "Browse the catalogue and check eligibility, quantities, and pricing before you book.",
    icon: Layers3,
  },
  {
    title: "Configure Smart Drip-Feed",
    description: "Compare Slow and Medium pacing or choose a duration. See planned quantities, intervals, and fees before booking eligible services.",
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
  support,
}: {
  browse: () => void;
  signIn: () => void;
  register: () => void;
  support: () => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    db?.rpc("voxx_catalogue", { manage: false }).then(({ data, error }) => {
      if (active && !error && data?.source === "live") {
        const { items } = data as Catalogue;
        setCategories([...new Set(items.map(({ category }) => category))].sort().slice(0, 8));
      }
    });
    return () => { active = false; };
  }, []);
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    const visual = event.currentTarget;
    const bounds = visual.getBoundingClientRect();
    visual.style.setProperty("--voxx-tilt-x", ((.5 - (event.clientY - bounds.top) / bounds.height) * 6) + "deg");
    visual.style.setProperty("--voxx-tilt-y", (((event.clientX - bounds.left) / bounds.width - .5) * 6) + "deg");
  }
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
            <p className="landing-kicker"><Radio size={16} aria-hidden="true" /> Social media marketing workspace</p>
            <h1 id="landing-title">VOXX SMM<span>SMM Panel &amp; Smart Drip-Feed</span></h1>
            <p className="landing-tagline">Smarter Social Media Marketing. Intelligent Scheduling. Real-Time Tracking.</p>
            <p className="landing-description">
              Manage authorized social media marketing services, configure intelligent campaign schedules, and track verified order progress in one workspace.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={register}>Create an account <ArrowRight size={17} /></button>
              <button className="landing-secondary" onClick={browse}>Browse services</button>
            </div>
          </div>
          <div className="landing-visual" onPointerMove={tilt} onPointerLeave={(event) => {
            event.currentTarget.style.removeProperty("--voxx-tilt-x");
            event.currentTarget.style.removeProperty("--voxx-tilt-y");
          }}>
            <div className="landing-particles" aria-hidden="true" />
            <div className="landing-orbit" aria-hidden="true"><i /><i /></div>
            <div className="landing-preview">
              <div className="landing-preview-head">
                <span>Smart Drip-Feed</span>
                <small>Illustrative submission plan</small>
              </div>
              <div className="landing-chart">
                <span>Planned batches by interval</span>
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
        {categories.length > 0 && <section className="landing-categories" aria-label="Published service categories">
          <h2>Browse published services</h2>
          <ul>{categories.map((category) => <li key={category}>{category}</li>)}</ul>
        </section>}
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
          <article className="landing-reseller"><h3>Reseller storefronts</h3><p>Eligible reseller accounts can customize their storefront, manage customer relationships, and issue API keys.</p></article>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <span>© {new Date().getFullYear()} VOXX SMM</span>
        <button onClick={support}>Support</button>
        <button onClick={signIn}>Customer sign in <ArrowUpRight size={14} /></button>
      </footer>
    </div>
  );
}
