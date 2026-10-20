import type { Knob, Metric } from "../engine/opt/explore";
import type { Unit } from "../engine/params/schema";

export const fmtUsd = (n: number | undefined, compact = true): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (!compact) return `${s}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}k`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}k`;
  return `${s}$${a.toFixed(a < 10 ? 2 : 0)}`;
};

export const fmtPct = (n: number | undefined, d = 2): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(d)}%`;
};

export const fmtBps = (n: number | undefined, d = 1): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)} bps`;
};

export const fmtX = (n: number | undefined, d = 2): string => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(d)}×`);

export const fmtDays = (n: number | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "never";
  if (n < 1) return `${(n * 24).toFixed(1)} h`;
  if (n > 730) return `${(n / 365).toFixed(1)} y`;
  return `${n.toFixed(0)} d`;
};

export const fmtNum = (n: number | undefined, d = 2): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
};


/** a parameter's value as shown in the panel (fractions as percent) */
export const toDisplay = (unit: Unit | undefined, v: number): number => (unit === "pct" ? v * 100 : v);
export const fromDisplay = (unit: Unit | undefined, v: number): number => (unit === "pct" ? v / 100 : v);
export const unitLabel = (unit?: Unit): string =>
  ({ pct: "%", bps: "bps", usd: "$", x: "×", days: "d", hours: "h", units: "", num: "", price: "$", minutes: "min" })[unit ?? "num"] ?? "";

export const fmtMetric = (m: Metric) => (v: number) => (m.unit === "pct" ? fmtPct(v) : m.unit === "usd" ? fmtUsd(v) : m.unit === "days" ? fmtDays(v) : fmtBps(v, 0));
export const fmtKnob = (k: Knob) => (v: number) =>
  k.unit === "pct" ? fmtPct(v, 1) : k.unit === "bps" ? `${v.toFixed(1)} bps` : k.unit === "x" ? fmtX(v, 2) : k.unit === "bool" ? (v >= 0.5 ? "on" : "off") : v.toFixed(v < 10 ? 3 : 0);
