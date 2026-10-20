import type { PathSummary } from "./mc";
import { SERIES } from "./mc";

export interface McRun {
  days: number;
  paths: number;
  /** per series: [p5, p25, p50, p75, p95] arrays over days */
  bands: Record<string, Float64Array[]>;
  /** one representative path (the median-APR one), per series */
  median: Record<string, Float64Array>;
  summaries: PathSummary[];
  ms: number;
}

export const QS = [0.05, 0.25, 0.5, 0.75, 0.95];

export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function aggregate(results: { series: Float32Array; days: number; summary: PathSummary }[], ms: number): McRun {
  const days = results[0]?.days ?? 0;
  const K = SERIES.length;
  const bands: Record<string, Float64Array[]> = {};
  const col = new Float64Array(results.length);
  SERIES.forEach((key, j) => {
    const qs = QS.map(() => new Float64Array(days));
    for (let d = 0; d < days; d++) {
      for (let i = 0; i < results.length; i++) col[i] = results[i].series[d * K + j];
      const sorted = Float64Array.from(col).sort();
      QS.forEach((q, k) => { qs[k][d] = quantile(sorted, q); });
    }
    bands[key] = qs;
  });
  // the path whose average vault APR is the median
  const order = results.map((r, i) => ({ i, v: (r.summary.aprEth + r.summary.aprBtc) / 2 })).sort((a, b) => a.v - b.v);
  const mid = results[order[Math.floor(order.length / 2)]?.i ?? 0];
  const median: Record<string, Float64Array> = {};
  SERIES.forEach((key, j) => {
    const a = new Float64Array(days);
    for (let d = 0; d < days; d++) a[d] = mid ? mid.series[d * K + j] : NaN;
    median[key] = a;
  });
  return { days, paths: results.length, bands, median, summaries: results.map((r) => r.summary), ms };
}

export function stat(values: number[]): { p5: number; p50: number; p95: number; mean: number } {
  const s = [...values].sort((a, b) => a - b);
  return { p5: quantile(s, 0.05), p50: quantile(s, 0.5), p95: quantile(s, 0.95), mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length) };
}
