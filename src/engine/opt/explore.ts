import { evaluate, type ClosedResult } from "../model/closedForm";
import { LARK4 } from "../params/defaults";
import { BY_PATH, getPath, setPath } from "../params/schema";
import type { Params } from "../params/types";

export interface Metric {
  key: string;
  label: string;
  unit: "pct" | "usd" | "days" | "bps";
  better: "high" | "low";
  of: (r: ClosedResult) => number;
}

export const METRICS: Metric[] = [
  { key: "worst", label: "user APR, worse vault", unit: "pct", better: "high", of: (r) => Math.min(r.vaults.eth.net, r.vaults.btc.net) },
  { key: "weighted", label: "user APR, TVL-weighted", unit: "pct", better: "high", of: (r) => r.totals.userAprWeighted },
  { key: "eth", label: "jETH user APR", unit: "pct", better: "high", of: (r) => r.vaults.eth.net },
  { key: "btc", label: "jBTC user APR", unit: "pct", better: "high", of: (r) => r.vaults.btc.net },
  { key: "protocol", label: "protocol revenue / yr", unit: "usd", better: "high", of: (r) => r.protocol.total },
  { key: "protocolPct", label: "protocol revenue, % of TVL", unit: "pct", better: "high", of: (r) => (r.totals.avgTvlUsd > 0 ? r.protocol.total / r.totals.avgTvlUsd : 0) },
  { key: "breakEven", label: "entry break-even", unit: "days", better: "low", of: (r) => r.breakEven.entryDays },
  { key: "deficit", label: "structural deficit", unit: "bps", better: "low", of: (r) => r.deficit.structuralBps },
  { key: "churn", label: "rebalance churn, worse vault", unit: "pct", better: "low", of: (r) => Math.max(r.vaults.eth.churn, r.vaults.btc.churn) },
];
export const METRIC = new Map(METRICS.map((m) => [m.key, m]));

/** knobs the explorer can move; "both vaults" knobs set the same value on jETH and jBTC */
export interface Knob {
  key: string;
  label: string;
  unit: "pct" | "bps" | "x" | "num" | "bool";
  min: number;
  max: number;
  lever: "admin" | "ops" | "contract" | "market";
  get: (p: Params) => number;
  set: (p: Params, v: number) => void;
}

const pathKnob = (path: string, min?: number, max?: number): Knob => {
  const d = BY_PATH.get(path)!;
  return {
    key: path,
    label: d.label,
    unit: d.kind === "bool" ? "bool" : d.unit === "pct" ? "pct" : d.unit === "bps" ? "bps" : d.unit === "x" ? "x" : "num",
    min: min ?? d.min ?? 0,
    max: max ?? d.max ?? 1,
    lever: d.lever === "model" || d.lever === "state" ? "market" : d.lever,
    get: (p) => {
      const v = getPath(p, path);
      return typeof v === "boolean" ? (v ? 1 : 0) : (v as number);
    },
    set: (p, v) => {
      const keys = path.split(".");
      let cur = p as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>;
      cur[keys[keys.length - 1]] = d.kind === "bool" ? v >= 0.5 : v;
    },
  };
};

const bothVaults = (key: string, label: string, min: number, max: number, get: (p: Params) => number, set: (p: Params, v: number) => void): Knob => ({
  key, label, unit: "pct", min, max, lever: "contract", get, set,
});

export const KNOBS: Knob[] = [
  {
    key: "leverage", label: "Loop leverage", unit: "x", min: 1.2, max: 8, lever: "admin",
    get: (p) => (p.loop.mode === "lev" ? p.loop.leverage : 1 / (1 - p.loop.primeLt / (p.loop.targetHf + p.loop.hfLag))),
    set: (p, v) => { p.loop.mode = "lev"; p.loop.leverage = v; },
  },
  bothVaults("bands.target", "Target LTV (both vaults)", 0.5, 0.8, (p) => p.vaults.btc.bandTarget, (p, v) => {
    for (const k of ["eth", "btc"] as const) {
      const gapLo = p.vaults[k].bandTarget - p.vaults[k].bandLo;
      const gapHi = p.vaults[k].bandHi - p.vaults[k].bandTarget;
      p.vaults[k].bandTarget = v;
      p.vaults[k].bandLo = v - gapLo;
      p.vaults[k].bandHi = Math.min(p.vaults[k].lt - 0.005, v + gapHi);
    }
  }),
  bothVaults("bands.relever", "Relever gap below target", 0.01, 0.25, (p) => p.vaults.btc.bandTarget - p.vaults.btc.bandLo, (p, v) => {
    for (const k of ["eth", "btc"] as const) p.vaults[k].bandLo = Math.max(0.05, p.vaults[k].bandTarget - v);
  }),
  bothVaults("bands.delever", "Delever gap above target", 0.005, 0.1, (p) => p.vaults.btc.bandHi - p.vaults.btc.bandTarget, (p, v) => {
    for (const k of ["eth", "btc"] as const) p.vaults[k].bandHi = Math.min(p.vaults[k].lt - 0.005, p.vaults[k].bandTarget + v);
  }),
  pathKnob("pool.feeBps", 0, 10),
  pathKnob("fees.protocolFeeBps", 0, 9000),
  pathKnob("fees.discountMain", 0, 1),
  pathKnob("fees.discountLoop", 0, 1),
  pathKnob("improvements.desk", 0, 1),
  pathKnob("improvements.deskSpreadBps", 0, 15),
  pathKnob("improvements.incentiveBps", 0, 300),
  pathKnob("market.hollarRate", 0.01, 0.1),
  pathKnob("market.primeYield", 0.02, 0.1),
  pathKnob("arb.sellBps", 0, 40),
  pathKnob("loop.solverBps", 0, 5),
  pathKnob("vaults.btc.vol", 0.1, 1),
  pathKnob("vaults.eth.vol", 0.1, 1.2),
  pathKnob("market.monitorMinutes", 1, 240),
  {
    key: "pool.depth", label: "Pool 143 depth (× today)", unit: "x", min: 1, max: 10, lever: "ops",
    get: (p) => p.pool.prime / LARK4.pool.prime,
    set: (p, v) => { p.pool.prime = LARK4.pool.prime * v; p.pool.hollar = LARK4.pool.hollar * v; },
  },
  pathKnob("loop.tranche", 500, 25_000),
  {
    key: "attribution.own", label: "Own-cost attribution", unit: "bool", min: 0, max: 1, lever: "contract",
    get: (p) => (p.improvements.attribution === "own" ? 1 : 0),
    set: (p, v) => { p.improvements.attribution = v >= 0.5 ? "own" : "pooled"; },
  },
];
export const KNOB = new Map(KNOBS.map((k) => [k.key, k]));

export function withKnob(p: Params, knob: Knob, v: number): Params {
  const q = structuredClone(p);
  knob.set(q, v);
  return q;
}

export function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));
}

export function sweep(p: Params, knob: Knob, n: number, metrics: Metric[]): { xs: number[]; ys: number[][] } {
  const xs = knob.unit === "bool" ? [0, 1] : linspace(knob.min, knob.max, n);
  const ys = metrics.map(() => [] as number[]);
  for (const x of xs) {
    const r = evaluate(withKnob(p, knob, x));
    metrics.forEach((m, i) => ys[i].push(m.of(r)));
  }
  return { xs, ys };
}

export function grid(p: Params, kx: Knob, ky: Knob, n: number, metric: Metric, feasible: (r: ClosedResult) => boolean) {
  const xs = kx.unit === "bool" ? [0, 1] : linspace(kx.min, kx.max, n);
  const ys = ky.unit === "bool" ? [0, 1] : linspace(ky.min, ky.max, n);
  const z = ys.map((yv) => xs.map((xv) => {
    const q = withKnob(withKnob(p, kx, xv), ky, yv);
    const r = evaluate(q);
    const v = metric.of(r);
    return feasible(r) && Number.isFinite(v) ? v : null;
  }));
  return { xs, ys, z };
}

export function tornado(p: Params, knobs: Knob[], metric: Metric, swing = 0.25) {
  const base = metric.of(evaluate(p));
  return knobs.map((k) => {
    const cur = k.get(p);
    let lo: number;
    let hi: number;
    if (k.unit === "bool") {
      lo = 0;
      hi = 1;
    } else if (cur === 0) {
      lo = k.min;
      hi = k.min + (k.max - k.min) * swing;
    } else {
      lo = Math.max(k.min, cur * (1 - swing));
      hi = Math.min(k.max, cur * (1 + swing));
    }
    return {
      knob: k,
      loValue: lo,
      hiValue: hi,
      lo: metric.of(evaluate(withKnob(p, k, lo))),
      hi: metric.of(evaluate(withKnob(p, k, hi))),
    };
  }).sort((a, b) => Math.abs(b.hi - b.lo) - Math.abs(a.hi - a.lo)).map((r) => ({ ...r, base }));
}

export interface Constraints {
  minUserApr: number;
  minProtocolPct: number;
  maxBreakEvenDays: number;
  noStall: boolean;
  noClose: boolean;
  minLiqDrop: number;
  /** HOLLAR Juicer may owe (loop + vaults); and/or stay within the facilitator's mint headroom */
  maxHollarUsd?: number;
  withinHeadroom?: boolean;
}

export function feasibleWith(c: Constraints) {
  return (r: ClosedResult) =>
    Math.min(r.vaults.eth.net, r.vaults.btc.net) >= c.minUserApr &&
    (r.totals.avgTvlUsd > 0 ? r.protocol.total / r.totals.avgTvlUsd : 0) >= c.minProtocolPct &&
    r.breakEven.entryDays <= c.maxBreakEvenDays &&
    (!c.noStall || !r.costs.stall) &&
    (!c.noClose || !r.deficit.depositsClose) &&
    r.lev.liqDrop >= c.minLiqDrop &&
    (c.maxHollarUsd === undefined || r.hollar.debtUsd <= c.maxHollarUsd) &&
    (!c.withinHeadroom || !r.hollar.overHeadroom) &&
    r.lev.valid;
}

export interface Candidate {
  values: Record<string, number>;
  params: Params;
  result: ClosedResult;
  score: number;
  feasible: boolean;
}

// small deterministic generator so searches reproduce
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** latin-hypercube search then coordinate refinement of the best feasible points */
export function search(p: Params, knobs: Knob[], metric: Metric, cons: Constraints, samples = 1500, seed = 1): { best: Candidate[]; all: Candidate[] } {
  const rand = rng(seed);
  const feasible = feasibleWith(cons);
  const sign = metric.better === "high" ? 1 : -1;
  const make = (values: Record<string, number>): Candidate => {
    const q = structuredClone(p);
    for (const k of knobs) k.set(q, values[k.key]);
    const result = evaluate(q);
    const raw = metric.of(result);
    const ok = feasible(result) && Number.isFinite(raw);
    return { values, params: q, result, score: ok ? sign * raw : -Infinity, feasible: ok };
  };
  const perms = knobs.map(() => {
    const a = Array.from({ length: samples }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  const all: Candidate[] = [make(Object.fromEntries(knobs.map((k) => [k.key, k.get(p)])))];
  for (let s = 0; s < samples; s++) {
    const values: Record<string, number> = {};
    knobs.forEach((k, i) => {
      const u = (perms[i][s] + rand()) / samples;
      values[k.key] = k.unit === "bool" ? (u >= 0.5 ? 1 : 0) : k.min + u * (k.max - k.min);
    });
    all.push(make(values));
  }
  const top = all.filter((c) => c.feasible).sort((a, b) => b.score - a.score).slice(0, 5);
  const refined = top.map((start) => {
    let cur = start;
    let step = 0.1;
    for (let round = 0; round < 6; round++, step /= 2) {
      for (const k of knobs) {
        if (k.unit === "bool") {
          const flip = make({ ...cur.values, [k.key]: cur.values[k.key] >= 0.5 ? 0 : 1 });
          if (flip.score > cur.score) cur = flip;
          continue;
        }
        for (const dir of [-1, 1]) {
          const v = Math.min(k.max, Math.max(k.min, cur.values[k.key] + dir * step * (k.max - k.min)));
          const c = make({ ...cur.values, [k.key]: v });
          if (c.score > cur.score) cur = c;
        }
      }
    }
    return cur;
  });
  const seen = new Set<string>();
  const best = [...refined, ...top].sort((a, b) => b.score - a.score).filter((c) => {
    const key = JSON.stringify(Object.values(c.values).map((v) => v.toFixed(4)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  return { best, all: all.concat(refined) };
}

/** non-dominated points on (user APR of the worse vault, protocol revenue) */
export function pareto(cands: Candidate[]): Candidate[] {
  const pts = cands.filter((c) => c.feasible).map((c) => ({ c, x: Math.min(c.result.vaults.eth.net, c.result.vaults.btc.net), y: c.result.protocol.total }));
  return pts.filter((a) => !pts.some((b) => b !== a && b.x >= a.x && b.y >= a.y && (b.x > a.x || b.y > a.y))).sort((a, b) => a.x - b.x).map((a) => a.c);
}

export { setPath };
