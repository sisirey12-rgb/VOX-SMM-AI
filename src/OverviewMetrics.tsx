import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Layers, Wallet } from "lucide-react";
import { db, money } from "./catalogue";
import { Loading } from "./UltraGlass";

export async function readWalletSummary(client: NonNullable<typeof db>) {
  const response = await fetch("/api/payment");
  if (!response.ok) return null;
  const { mode } = await response.json();
  if (mode !== "test" && mode !== "live") return null;
  const { data, error } = await client.rpc("voxx_balance", { wallet_mode: mode });
  return error || data == null ? null : { value: money(Number(data) / 100), mode };
}

type Metrics = {
  orders: number | null;
  campaigns: number | null;
  wallet: string | null;
  walletMode: string;
};

export function OverviewMetrics({ user, admin, navigate }: {
  user: string;
  admin: boolean;
  navigate: (page: string) => void;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  useEffect(() => {
    const client = db;
    if (!client) return;
    let active = true;
    const orders = client.from("voxx_orders").select("id", { head: true, count: "exact" });
    const campaigns = client.from("voxx_campaigns").select("id", { head: true, count: "exact" }).eq("state", "Active");
    Promise.allSettled([
      admin ? orders : orders.eq("owner_id", user),
      admin ? campaigns : campaigns.eq("owner_id", user),
      admin ? Promise.resolve(null) : readWalletSummary(client),
    ]).then(([orderResult, campaignResult, balanceResult]) => {
      if (!active) return;
      const balance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
      setMetrics({
        orders: orderResult.status === "fulfilled" && !orderResult.value.error ? orderResult.value.count : null,
        campaigns: campaignResult.status === "fulfilled" && !campaignResult.value.error ? campaignResult.value.count : null,
        wallet: balance?.value ?? null,
        walletMode: balance?.mode ?? "",
      });
    });
    return () => { active = false; };
  }, [user, admin]);

  const cards = [
    { label: "Order records", value: metrics?.orders?.toLocaleString(), icon: Layers, page: admin ? "Orders" : "My Orders" },
    { label: "Active campaigns", value: metrics?.campaigns?.toLocaleString(), icon: CalendarDays, page: "Campaigns" },
    admin
      ? { label: "Review settlement", value: "Wallet ledger", icon: Wallet, page: "Wallet ledger" }
      : { label: metrics?.walletMode === "test" ? "Test wallet balance" : "Wallet balance", value: metrics?.wallet, icon: Wallet, page: "Wallet" },
  ];

  return (
    <section className="glass-metrics" aria-label="Workspace overview">
      {cards.map(({ label, value, icon: Icon, page }) => (
        <button className="panel glass-metric" key={page} onClick={() => navigate(page)}>
          <span className="glass-metric-top"><Icon size={19} aria-hidden="true" /><ArrowUpRight size={16} aria-hidden="true" /></span>
          <span>{label}</span>
          {metrics ? <strong>{value ?? "Unavailable"}</strong> : <Loading label="Loading" />}
        </button>
      ))}
    </section>
  );
}
