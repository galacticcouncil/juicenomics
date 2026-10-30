// refit the closed form's NETTING curve to the Monte Carlo: steady state at 1-50× Lark 4's TVL, wide band, a 2 bps pool fee
// npm exec tsx scripts/fit-netting.mts -- [--paths 32] [--seed 7] [--mults 1,2,5,10,20,35,50]
import { NETTING, evaluate } from "../src/engine/model/closedForm";
import { LARK4, clone } from "../src/engine/params/defaults";
import type { Params } from "../src/engine/params/types";
import { num, parseArgs, scaleTvl } from "./lib/config.mts";
import { runMc } from "./lib/mc.mts";

const a = parseArgs(process.argv.slice(2));
const PATHS = num(a, "paths", 32);
const SEED = num(a, "seed", LARK4.sim.seed);
const MULTS = typeof a.flags.mults === "string" ? a.flags.mults.split(",").map(Number) : [1, 2, 5, 10, 20, 35, 50];
const tvl0 = LARK4.vaults.btc.units * LARK4.vaults.btc.price;

// the loop discount's dollar cap isn't trading, so it's lifted; the fee scales every cost alike, so residuals are
// divided by (1 − fee) to read as trading cost
const config = (m: number): Params => {
  const p = scaleTvl(clone(LARK4), tvl0 * m);
  p.sim.initial = "ramped";
  p.pool.feeBps = 2;
  p.policy.costReserveBps = 0;
  p.fees.loopDiscountCapUsd = 1e9;
  p.sim.seed = SEED;
  return p;
};
const gross = 1 / (1 - LARK4.fees.protocolFeeBps / 1e4);

const cells: { m: number; p: Params; mc: number }[] = [];
for (const m of MULTS) {
  const p = config(m);
  const run = await runMc(p, { paths: PATHS });
  const mc = run.summaries.reduce((s, x) => s + x.aprBtc, 0) / run.summaries.length;
  cells.push({ m, p, mc });
  process.stderr.write(`${m}× mc ${(mc * 100).toFixed(3)}% (${(run.ms / 1000).toFixed(0)} s)\n`);
}

const rmse = (c: typeof NETTING) => {
  Object.assign(NETTING, c);
  return gross * Math.sqrt(cells.reduce((s, x) => s + (evaluate(x.p).vaults.btc.net - x.mc) ** 2, 0) / cells.length);
};
const start = { ...NETTING };
const before = rmse(start);
let best = { ...start };
let err = before;
for (let step = 0.5; step > 0.002; step /= 2) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const k of ["floor", "base", "div"] as const) {
      for (const dir of [-1, 1]) {
        const c = { ...best, [k]: k === "div" ? best.div * (1 + dir * step) : best[k] + dir * step };
        if (c.div <= 0 || c.base <= c.floor) continue;
        const e = rmse(c);
        if (e < err - 1e-7) {
          best = c;
          err = e;
          moved = true;
        }
      }
    }
  }
}
Object.assign(NETTING, best);
const rows = cells.map((x) => ({ mult: x.m, tvlUsd: tvl0 * x.m, mc: x.mc, cfFitted: evaluate(x.p).vaults.btc.net }));
Object.assign(NETTING, start);
for (const [i, x] of cells.entries()) Object.assign(rows[i], { cfBefore: evaluate(x.p).vaults.btc.net });
process.stdout.write(`${JSON.stringify({ paths: PATHS, rmse: "pp of APR before the protocol fee", before: { netting: start, rmsePp: before * 100 }, after: { netting: best, rmsePp: err * 100 }, rows }, null, 2)}\n`);
