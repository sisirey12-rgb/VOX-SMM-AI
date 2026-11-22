import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  Users,
  Settings,
  Layers,
  BarChart3,
  Shield,
  Menu,
  X,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import "./style.css";
import "./ultra-glass.css";
import "./atmosphere.css";
import "./workspace-layout.css";
import { PartnerAdmin } from "./PartnerAdmin";
import { Partner, StoreBanner } from "./Partner";
import { Campaigns, Rules } from "./Controls";
import { Workspace } from "./Workspace";
import { Orders } from "./Orders";
import { db } from "./catalogue";
import { Services } from "./Services";
import { Bundles } from "./Bundles";
import { Account, useAccount } from "./Account";
import { Landing } from "./Landing";
import { GlassDialog, PageSearch } from "./UltraGlass";
import { OverviewMetrics } from "./OverviewMetrics";
import { NotificationCenter } from "./NotificationCenter";
import { readPalette, ThemeSettings, type Palette } from "./Theme";
type Role = "customer" | "admin";
const navigationGroups = {
  customer: [
    {
      label: "Workspace",
      pages: [
        ["Overview", LayoutDashboard],
        ["Notifications", Layers],
      ],
    },
    {
      label: "Orders & campaigns",
      pages: [
        ["Service Catalogue", Layers],
        ["Smart Bundles", Layers],
        ["New Campaign", ShoppingCart],
        ["My Orders", Layers],
        ["Campaigns", Layers],
      ],
    },
    {
      label: "Wallet & reseller",
      pages: [
        ["Wallet", Wallet],
        ["Payments", Wallet],
        ["Reseller", Users],
        ["My customers", Users],
      ],
    },
    {
      label: "Preferences & help",
      pages: [
        ["Theme", Settings],
        ["Settings", Settings],
        ["Support", Layers],
      ],
    },
  ],
  admin: [
    {
      label: "Workspace",
      pages: [
        ["Overview", LayoutDashboard],
        ["Analytics", BarChart3],
        ["Notifications", Layers],
      ],
    },
    {
      label: "Catalogue & fulfillment",
      pages: [
        ["Orders", ShoppingCart],
        ["Campaigns", Layers],
        ["Services", Layers],
        ["Smart Bundles", Layers],
        ["Pricing", Wallet],
        ["Schedule limits", Settings],
        ["Providers", Shield],
      ],
    },
    {
      label: "Accounts & finance",
      pages: [
        ["Customers", Users],
        ["Reseller keys", Shield],
        ["Storefronts", Users],
        ["Wallet ledger", Wallet],
        ["Payments", Wallet],
        ["Currency", Wallet],
      ],
    },
    {
      label: "Operations",
      pages: [
        ["Sync history", Layers],
        ["Worker health", Shield],
        ["Audit", Shield],
        ["Support", Layers],
        ["Website settings", Settings],
      ],
    },
    {
      label: "Preferences",
      pages: [
        ["Theme", Settings],
        ["Settings", Settings],
      ],
    },
  ],
} as const;

function App() {
  const [palette, setPalette] = useState(readPalette);
  const [animated, setAnimated] = useState(() => localStorage.getItem("voxx-theme-motion") !== "still");
  const [light, setLight] = useState(
    localStorage.getItem("voxx-theme") === "light",
  );
  const [welcome, setWelcome] = useState("Grow your brand with clarity.");
  useEffect(() => {
    db?.from("voxx_site")
      .select("welcome")
      .single()
      .then((r) => {
        if (r.data) setWelcome(r.data.welcome);
      });
  }, []);
  const params = new URLSearchParams(location.search);
  const detailId = params.get("order");
  const { ready, session, isAdmin, accountRole } = useAccount();
  const [register, setRegister] = useState(false);
  const [requested, setRole] = useState<Role>("customer"),
    [requestedPage, setPage] = useState(
      detailId
        ? "Order details"
        : params.has("account")
          ? "Account"
          : "Overview",
    ),
    [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const userId = session?.user.id;
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      setRole("customer");
      setPage("Account");
      setMobile(false);
    }
    previousUser.current = userId;
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const url = new URL(location.href);
    if (url.searchParams.get("account") !== "google") return;
    url.searchParams.delete("account");
    history.replaceState(history.state, "", url);
    setPage("Overview");
  }, [userId]);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) return;
    mobileClose.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobile(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      mobileToggle.current?.focus();
    };
  }, [mobile]);
  const accountChanged = !!previousUser.current && previousUser.current !== userId;
  const role = requested === "admin" && isAdmin && !accountChanged ? "admin" : "customer";
  const page = accountChanged || (requested === "admin" && !isAdmin) ||
    (["Reseller", "My customers"].includes(requestedPage) && accountRole !== "reseller") ? "Account" : requestedPage;
  const groups = navigationGroups[role].map((group) => ({
    label: group.label,
    pages: group.pages.filter(([label]) =>
      !["Reseller", "My customers"].includes(label) || accountRole === "reseller",
    ),
  }));
  const nav = groups.flatMap((group) => group.pages.map(([label]) => label));
  function saveAppearance(value: boolean) {
    setLight(value);
    localStorage.setItem("voxx-theme", value ? "light" : "dark");
  }
  function savePalette(value: Palette) {
    setPalette(value);
    localStorage.setItem("voxx-palette", value);
  }
  function saveMotion(value: boolean) {
    setAnimated(value);
    localStorage.setItem("voxx-theme-motion", value ? "animated" : "still");
  }
  function switchRole(r: Role) {
    setRole(r);
    setPage("Overview");
    setMobile(false);
  }
  function openAccount(create = false) {
    setRole("customer");
    setRegister(create);
    setPage("Account");
  }
  function navigate(destination: string) {
    setPage(destination);
    setMobile(false);
  }
  if (!params.has("store") && page === "Overview" && !session) {
    if (!ready) return <p role="status" className="content">Loading VOXX…</p>;
    return (
      <Landing
        browse={() => setPage("Service Catalogue")}
        signIn={() => openAccount()}
        register={() => openAccount(true)}
        support={() => navigate("Support")}
      />
    );
  }
  return (
    <div className={`app nexus${light ? " light" : ""}${collapsed ? " sidebar-collapsed" : ""}`} data-palette={palette} data-motion={animated ? "animated" : "still"}>
      <div className="theme-atmosphere" aria-hidden="true" />
      <a className="glass-skip" href="#workspace-content">Skip to content</a>
      {mobile && <button className="glass-backdrop" aria-label="Dismiss navigation" onClick={() => setMobile(false)} />}
      <aside id="workspace-navigation" className={mobile ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <img className="brand-icon" src="/brand/voxx-mark.svg" alt="" width="40" height="40" />
          <div className="glass-brand-text">
            VOXX<span>MARKETING PLATFORM</span>
          </div>
          <button
            aria-label="Close navigation"
            ref={mobileClose}
            className="mobile-close"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Workspace navigation">
          {navigationGroups[role].map((group) => (
            <div className="workspace-nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.pages.map(([label, Icon]) => (
                  <button
                    key={label}
                    title={label}
                    aria-current={page === label ? "page" : undefined}
                    className={page === label ? "nav active" : "nav"}
                    onClick={() => navigate(label)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">VX</div>
          <div className="glass-identity">
            <strong>{session?.user.email ?? "Guest preview"}</strong>
            <small>
              {role === "admin" ? "Administrator" : "Customer workspace"}
            </small>
          </div>
        </div>
      </aside>
      <main className="glass-main">
        <header>
          <div className="head-left">
            <button
              aria-label="Open navigation"
              ref={mobileToggle}
              aria-controls="workspace-navigation"
              aria-expanded={mobile}
              className="mobile-menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <button className="glass-action glass-sidebar-toggle" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-controls="workspace-navigation" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <div>
              <small>{role === "admin" ? "Admin workspace" : "Customer workspace"}</small>
              <h1>{page}</h1>
            </div>
          </div>
          <div className="glass-top-actions">
            <PageSearch pages={nav} navigate={navigate} />
            {session && <NotificationCenter key={session.user.id} userId={session.user.id} openPage={() => navigate("Notifications")} />}
            <div className="switch">
            <button
              aria-label="Switch colour theme"
              onClick={() => saveAppearance(!light)}
            >
              {light ? "Dark" : "Light"}
            </button>
            <button className={role === "customer" ? "selected" : ""} onClick={() => switchRole("customer")}>
              {session ? "Customer" : "Home"}
            </button>
            {isAdmin && (
              <button
                className={role === "admin" ? "selected" : ""}
                onClick={() => switchRole("admin")}
              >
                Admin
              </button>
            )}
              {session ? (
                <GlassDialog title="Your VOXX account" trigger="Account">
                  {(close) => <div className="glass-dialog-body">
                    <p>{session.user.email}</p>
                    <button type="button" className="glass-action" onClick={() => { close(); openAccount(); }}>Account and security</button>
                  </div>}
                </GlassDialog>
              ) : <button onClick={() => openAccount()}>Sign in</button>}
            </div>
          </div>
        </header>
        <div className="content" id="workspace-content" tabIndex={-1}>
          <StoreBanner user={session?.user.id ?? ""} />
          {page === "Order details" && detailId ? (
            <Orders
              key={[detailId, session?.user.id, isAdmin].join("-")}
              detail={detailId}
              manage={isAdmin}
              user={session?.user.id}
            />
          ) : page === "Overview" ? (
            <div className="workspace-overview">
              <div className="workspace-overview-top">
                <div className="hero">
                  <div>
                    <h2>
                      {role === "admin" ? "Your business, in focus." : welcome}
                    </h2>
                    <button
                      onClick={() =>
                        setPage(role === "admin" ? "Orders" : "New Campaign")
                      }
                    >
                      {role === "admin" ? "View orders" : "Create campaign"}{" "}
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <img className="hero-art glass-hero-mark" src="/brand/voxx-mark.svg" alt="" />
                </div>
                {session && <OverviewMetrics key={`${session.user.id}/${role}`} user={session.user.id} admin={role === "admin"} navigate={navigate} />}
              </div>
              <section className="panel">
                <div className="panel-title">
                  <h3>Recent orders</h3>
                  <button
                    onClick={() =>
                      setPage(role === "admin" ? "Orders" : "My Orders")
                    }
                  >
                    View all →
                  </button>
                </div>
                <Orders
                  key={[role, session?.user.id].join("-")}
                  user={session?.user.id}
                  manage={role === "admin"}
                />
              </section>
            </div>
          ) : page === "Orders" || page === "My Orders" ? (
            <section className="panel">
              <div className="panel-title">
                <h3>Order history</h3>
              </div>
              <Orders
                key={[role, session?.user.id].join("-")}
                user={session?.user.id}
                manage={role === "admin"}
              />
            </section>
          ) : page === "Reseller keys" && isAdmin ? (
            <PartnerAdmin />
          ) : page === "Reseller" ? (
            <Partner key={session?.user.id} user={session?.user.id ?? ""} />
          ) : page === "Campaigns" ? (
            <Campaigns
              key={[role, session?.user.id].join("-")}
              admin={role === "admin"}
              user={session?.user.id ?? ""}
            />
          ) : role === "admin" &&
            ["Pricing", "Schedule limits"].includes(page) ? (
            <Rules key={page} schedule={page === "Schedule limits"} />
          ) : page === "Theme" ? (
            <ThemeSettings palette={palette} light={light} animated={animated}
              setPalette={savePalette} setLight={saveAppearance} setAnimated={saveMotion} />
          ) : page === "Account" || page === "Settings" ? (
            <Account key={`${register}/${userId ?? "guest"}`} session={session} register={register} role={accountRole} wallet={() => { setRole("customer"); navigate("Wallet"); }} onSignedIn={() => navigate("Overview")} />
          ) : page === "Smart Bundles" ? (
            <Bundles key={role + '/' + (userId ?? '')} manage={role === "admin"} user={userId} />
          ) : page === "Service Catalogue" ||
            page === "New Campaign" ||
            (role === "admin" && ["Services", "Providers"].includes(page)) ? (
            <Services
              key={[page, session?.user.id].join("-")}
              manage={role === "admin"}
              campaign={page === "New Campaign"}
            />
          ) : (
            <Workspace
              admin={role === "admin"}
              key={[page, session?.user.id].join("-")}
              page={page}
              user={session?.user.id ?? ""}
            />
          )}
          <footer>© {new Date().getFullYear()} VOXX</footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
