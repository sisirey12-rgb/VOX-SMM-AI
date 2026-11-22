import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import "./style.css";
import { PartnerAdmin } from "./PartnerAdmin";
import { Partner, StoreBanner } from "./Partner";
import { Campaigns, Rules } from "./Controls";
import { Workspace } from "./Workspace";
import { Orders } from "./Orders";
import { db } from "./catalogue";
import { Services } from "./Services";
import { Account, useAccount } from "./Account";
type Role = "customer" | "admin";
const customer = [
  ["Overview", LayoutDashboard],
  ["Service Catalogue", Layers],
  ["New Campaign", ShoppingCart],
  ["My Orders", Layers],
  ["Wallet", Wallet],
  ["Payments", Wallet],
  ["Reseller", Users],
  ["My customers", Users],
  ["Support", Layers],
  ["Campaigns", Layers],
  ["Notifications", Layers],
  ["Settings", Settings],
] as const;
const admin = [
  ["Overview", LayoutDashboard],
  ["Orders", ShoppingCart],
  ["Services", Layers],
  ["Customers", Users],
  ["Providers", Shield],
  ["Reseller keys", Shield],
  ["Wallet ledger", Wallet],
  ["Storefronts", Users],
  ["Analytics", BarChart3],
  ["Pricing", Wallet],
  ["Schedule limits", Settings],
  ["Sync history", Layers],
  ["Worker health", Shield],
  ["Currency", Wallet],
  ["Website settings", Settings],
  ["Audit", Shield],
  ["Payments", Wallet],
  ["Support", Layers],
  ["Campaigns", Layers],
  ["Notifications", Layers],
  ["Settings", Settings],
] as const;
function App() {
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
  const detailId = new URLSearchParams(location.search).get("order");
  const { session, isAdmin, accountRole } = useAccount();
  const [requested, setRole] = useState<Role>("customer"),
    [requestedPage, setPage] = useState(
      detailId
        ? "Order details"
        : new URLSearchParams(location.search).has("account")
          ? "Account"
          : "Overview",
    ),
    [mobile, setMobile] = useState(false);
  const role = requested === "admin" && isAdmin ? "admin" : "customer";
  const page = requested === "admin" && !isAdmin ? "Account" : requestedPage;
  const nav =
    role === "admin"
      ? admin
      : customer.filter(
          ([label]) =>
            !["Reseller", "My customers"].includes(label) ||
            accountRole === "reseller",
        );
  function switchRole(r: Role) {
    setRole(r);
    setPage("Overview");
    setMobile(false);
  }
  return (
    <div className={light ? "app light" : "app"}>
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="logo">V</div>
          <div>
            VOXX<span>MARKETING PLATFORM</span>
          </div>
          <button
            aria-label="Close navigation"
            className="mobile-close"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={page === label ? "nav active" : "nav"}
              onClick={() => {
                setPage(label);
                setMobile(false);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">VX</div>
          <div>
            <strong>{session?.user.email ?? "Guest preview"}</strong>
            <small>
              {role === "admin" ? "Administrator" : "Customer workspace"}
            </small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="head-left">
            <button
              aria-label="Open navigation"
              className="mobile-menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <div>
              <small>VOXX / {role === "admin" ? "ADMIN" : "CUSTOMER"}</small>
              <h1>{page}</h1>
            </div>
          </div>
          <div className="switch">
            <button
              aria-label="Switch colour theme"
              onClick={() => {
                setLight(!light);
                localStorage.setItem("voxx-theme", light ? "dark" : "light");
              }}
            >
              {light ? "Dark" : "Light"}
            </button>
            <button
              className={role === "customer" ? "selected" : ""}
              onClick={() => switchRole("customer")}
            >
              Customer
            </button>
            {isAdmin && (
              <button
                className={role === "admin" ? "selected" : ""}
                onClick={() => switchRole("admin")}
              >
                Admin
              </button>
            )}
            <button
              onClick={() => {
                setRole("customer");
                setPage("Account");
              }}
            >
              {session ? "Account" : "Sign in"}
            </button>
          </div>
        </header>
        <div className="content">
          <StoreBanner user={session?.user.id ?? ""} />
          {page === "Order details" && detailId ? (
            <Orders
              key={[detailId, session?.user.id, isAdmin].join("-")}
              detail={detailId}
              manage={isAdmin}
              user={session?.user.id}
            />
          ) : page === "Overview" ? (
            <>
              <div className="hero">
                <div>
                  <div className="eyebrow">WELCOME TO VOXX</div>
                  <h2>
                    {role === "admin" ? "Your business, in focus." : welcome}
                  </h2>
                  <p>
                    {role === "admin"
                      ? "Monitor customers, campaigns and service operations from one dashboard."
                      : "Manage authorized marketing campaigns in a simple, unified workspace."}
                  </p>
                  <button
                    onClick={() =>
                      setPage(role === "admin" ? "Orders" : "New Campaign")
                    }
                  >
                    {role === "admin" ? "View orders" : "Create campaign"}{" "}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="hero-art">V</div>
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
            </>
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
          ) : page === "Account" || page === "Settings" ? (
            <Account session={session} />
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
              key={[page, session?.user.id].join("-")}
              page={page}
              user={session?.user.id ?? ""}
            />
          )}
          <footer>© 2026 VOXX · Development preview</footer>
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
