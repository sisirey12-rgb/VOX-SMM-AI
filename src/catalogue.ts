import { createClient } from "@supabase/supabase-js";
import fixture from "./mock-services.json";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const db = url && key ? createClient(url, key) : null;
export interface Service {
  id: number;
  name: string;
  category: string;
  type: string;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  price: number;
  cost?: number;
  fixed?: number | null;
  visible?: boolean;
}
export interface Catalogue {
  source: "mock" | "live";
  markup: number | null;
  items: Service[];
}
export const preview: Catalogue = {
  source: "mock",
  markup: null,
  items: fixture.map((r) => ({
    id: r.service,
    name: r.name,
    category: r.category,
    type: r.type,
    min: Number(r.min),
    max: Number(r.max),
    refill: r.refill,
    cancel: r.cancel,
    price: Number(r.rate) * 1.25,
  })),
};
export const money = (n: number) =>
  n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
