import os from "node:os";
import { Worker } from "node:worker_threads";
import type { PathSummary } from "../../src/engine/sim/mc";
import { SERIES } from "../../src/engine/sim/mc";
import type { Params } from "../../src/engine/params/types";

export interface McOptions {
  paths: number;
  workers?: number;
  /** keep daily series (memory grows with paths × days) */
  series?: boolean;
  /** Hydration's wasm stableswap instead of the float mirror; defaults to the params' sim.poolMode */
  exact?: boolean;
  /** first path index, so batches can be split or extended without repeating seeds */
  start?: number;
}

export interface McRun {
  summaries: PathSummary[];
  series: Float32Array[];
  days: number;
  ms: number;
}

/** paths in parallel worker threads; path i always uses seed (sim.seed, i), so results don't depend on the split */
export async function runMc(params: Params, o: McOptions): Promise<McRun> {
  const t0 = Date.now();
  const n = Math.max(1, Math.floor(o.paths));
  const start = o.start ?? 0;
  const w = Math.max(1, Math.min(o.workers ?? Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1), n));
  const summaries: PathSummary[] = new Array(n);
  const series: Float32Array[] = o.series ? new Array(n) : [];
  let days = 0;
  const chunks = Array.from({ length: w }, (_, j) => Array.from({ length: n }, (_, i) => i).filter((i) => i % w === j).map((i) => start + i));
  await Promise.all(chunks.map((indices) => new Promise<void>((resolve, reject) => {
    if (!indices.length) return resolve();
    const worker = new Worker(new URL("../sim-worker.mts", import.meta.url), { execArgv: ["--import", "tsx"] });
    worker.on("message", (m: { i?: number; summary?: PathSummary; series?: Float32Array; days?: number; done?: boolean; error?: string }) => {
      if (m.error) {
        reject(new Error(m.error));
        void worker.terminate();
      } else if (m.done) {
        void worker.terminate();
        resolve();
      } else if (m.i !== undefined && m.summary) {
        summaries[m.i - start] = m.summary;
        if (o.series && m.series) series[m.i - start] = m.series;
        days = m.days ?? days;
      }
    });
    worker.on("error", reject);
    worker.postMessage({ params, indices, series: !!o.series, exact: o.exact ?? params.sim.poolMode === "exact" });
  })));
  return { summaries, series, days, ms: Date.now() - t0 };
}

export interface Stat {
  mean: number;
  se: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export function stat(values: number[]): Stat {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (x: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(x * (s.length - 1))))] : NaN);
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { mean, se: sd / Math.sqrt(Math.max(1, s.length)), p5: q(0.05), p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95) };
}

/** every numeric summary field across paths, plus the worse vault's APR */
export function summarize(summaries: PathSummary[], fields?: string[]): Record<string, Stat> {
  const keys = fields ?? Object.keys(summaries[0] ?? {}).filter((k) => typeof (summaries[0] as unknown as Record<string, unknown>)[k] === "number");
  const out: Record<string, Stat> = {};
  for (const k of keys) out[k] = stat(summaries.map((s) => (s as unknown as Record<string, number>)[k]));
  out.aprWorst = stat(summaries.map((s) => Math.min(s.aprEth, s.aprBtc)));
  return out;
}

/** daily quantiles of each series (p10/p50/p90) */
export function seriesBands(series: Float32Array[], days: number) {
  const K = SERIES.length;
  const out: Record<string, { p10: number[]; p50: number[]; p90: number[] }> = {};
  SERIES.forEach((key, j) => {
    const b = { p10: [] as number[], p50: [] as number[], p90: [] as number[] };
    for (let d = 0; d < days; d++) {
      const col = series.map((s) => s[d * K + j]).sort((a, b) => a - b);
      const q = (x: number) => col[Math.min(col.length - 1, Math.round(x * (col.length - 1)))];
      b.p10.push(q(0.1));
      b.p50.push(q(0.5));
      b.p90.push(q(0.9));
    }
    out[key] = b;
  });
  return out;
}
