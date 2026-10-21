// configuration study across TVLs and leverages: closed-form search per cell, Monte Carlo verification of each winner
// npm exec tsx scripts/study-tvl.mts -- [--tvls 1e5,…] [--levs 1.5,…] [--paths 32] [--samples 600] [--out file.json]
import { writeFileSync } from "node:fs";
import { evaluate } from "../src/engine/model/closedForm";
import { KNOB, METRIC, search, type Constraints } from "../src/engine/opt/explore";
import { LARK4, clone } from "../src/engine/params/defaults";
import type { Params } from "../src/engine/params/types";
import { encode } from "../src/engine/share/codec";
import { cfSummaryLite } from "./lib/report.mts";
import { num, parseArgs, scaleTvl, str } from "./lib/config.mts";
import { runMc, summarize } from "./lib/mc.mts";

const a = parseArgs(process.argv.slice(2));
const list = (k: string, d: number[]) => (typeof a.flags[k] === "string" ? (a.flags[k] as string).split(",").map(Number) : d);
const TVLS = list("tvls", [1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6]);
const LEVS = list("levs", [1.5, 2, 3, 4, 5, 6]);
const PATHS = num(a, "paths", 32);
const SAMPLES = num(a, "samples", 600);

// knobs per tier; leverage is fixed per row, fee and discount only move under the "floor" policy
// pool 143 stays at today's depth here (more depth is treasury PRIME + newly minted HOLLAR); --depth sets it
// the treasury desk in peg mode is ops (a market maker on treasury aPRIME); direct fills would need integration
const EFFICIENCY = { today: ["pool.feeBps", "market.monitorMinutes", "loop.tranche", "improvements.desk", "improvements.deskSpreadBps"], contract: ["pool.feeBps", "market.monitorMinutes", "loop.tranche", "bands.target", "bands.relever", "bands.delever", "improvements.desk", "improvements.deskSpreadBps", "attribution.own"] };
const DEPTH = num(a, "depth", 1);
const SPLIT = { today: ["fees.protocolFeeBps", "fees.discountMain"], contract: ["fees.protocolFeeBps", "fees.discountMain", "fees.discountLoop"] };
const POLICIES = [
  { key: "todaySplit", label: "today's split (5% fee, no discount)", floor: -10, moveSplit: false },
  { key: "floor5", label: "protocol keeps ≥ 5% of TVL", floor: 0.05, moveSplit: true },
] as const;

const base = (tvl: number, L: number): Params => {
  const p = scaleTvl(clone(LARK4), tvl);
  p.sim.initial = "ramped";
  p.loop.mode = "lev";
  p.loop.leverage = L;
  p.pool.prime = LARK4.pool.prime * DEPTH;
  p.pool.hollar = LARK4.pool.hollar * DEPTH;
  return p;
};

const rows: Record<string, unknown>[] = [];
const t0 = Date.now();
for (const tvl of TVLS) {
  for (const L of LEVS) {
    for (const tier of ["today", "contract"] as const) {
      for (const pol of POLICIES) {
        const keys = [...EFFICIENCY[tier], ...(pol.moveSplit ? SPLIT[tier] : [])];
        const knobs = keys.map((k) => {
          const knob = KNOB.get(k);
          if (!knob) throw new Error(`no knob ${k}`);
          // treasury liquidity in pool 143 up to 3× today's; it takes PRIME and HOLLAR the treasury must find
          // a fee-free pool isn't on offer; keepers between 5 min and 4 h; tranches 1k–10k
          return k === "pool.feeBps" ? { ...knob, min: 1, max: 10 } : k === "loop.tranche" ? { ...knob, min: 1000, max: 10_000 } : k === "market.monitorMinutes" ? { ...knob, min: 5, max: 240 } : knob;
        });
        const cons: Constraints = { minUserApr: -1, minProtocolPct: pol.floor, maxBreakEvenDays: Infinity, noStall: true, noClose: true, minLiqDrop: 0 };
        const p0 = base(tvl, L);
        const res = search(p0, knobs, METRIC.get("worst")!, cons, SAMPLES, 7);
        const best = res.best[0];
        const row: Record<string, unknown> = { tvl, leverage: L, tier, policy: pol.key, feasible: !!best, evaluated: res.all.length };
        if (best) {
          const run = await runMc(best.params, { paths: PATHS });
          const mc = summarize(run.summaries, ["aprEth", "aprBtc", "protocol", "hollarInterest", "collateralFee", "lpFees", "entryAvgBps", "unwindAvgBps", "stallHours", "unwindStallHours", "arbDryHours", "stopHoursEth", "stopHoursBtc", "minHf", "hollarDebtPeakUsd", "arbHollarNetUsd", "deskHollarNetUsd", "conservationGapUsd", "releversBtc", "deleversBtc"]);
          const r = evaluate(best.params);
          Object.assign(row, {
            values: best.values,
            cf: cfSummaryLite(r),
            mc: Object.fromEntries(Object.entries(mc).map(([k, s]) => [k, { mean: s.mean, se: s.se, p10: s.p10, p50: s.p50, p90: s.p90 }])),
            link: `https://juicer-sim.lark.hydration.cloud/#s=${await encode(best.params)}`,
          });
        }
        rows.push(row);
        const cf = row.cf as { worst: number } | undefined;
        const mcw = (row.mc as Record<string, { p50: number }> | undefined)?.aprWorst?.p50;
        process.stderr.write(`${(tvl / 1e6).toFixed(2)}M ${L}× ${tier.padEnd(8)} ${pol.key.padEnd(10)} cf ${cf ? (cf.worst * 100).toFixed(2) : "—"} mc ${mcw !== undefined ? (mcw * 100).toFixed(2) : "—"}  (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
      }
    }
  }
}
const outFile = str(a, "out", "");
const doc = { generated: new Date().toISOString(), paths: PATHS, samples: SAMPLES, depth: DEPTH, start: "ramped (steady state)", horizonDays: 365, tvls: TVLS, leverages: LEVS, policies: POLICIES, rows };
if (outFile) writeFileSync(outFile, JSON.stringify(doc));
process.stdout.write(`${JSON.stringify(doc)}\n`);
