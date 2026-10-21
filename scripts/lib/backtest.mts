import { DEPLOYMENTS, loadLive } from "../../src/engine/live/live";
import { leverage } from "../../src/engine/model/closedForm";
import { LARK4, clone } from "../../src/engine/params/defaults";
import type { Params } from "../../src/engine/params/types";
import { runPath, SERIES, SERIES_INDEX } from "../../src/engine/sim/mc";

interface Sample {
  block: number;
  t: number;
  p: Params;
  principal: number;
  hole: number;
}

// principal less equityOf, which counts HOLLAR in flight; the Aave position alone jumps while entries wait to fill
const hole = (p: Params) => p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal - (p.vaults.eth.loopEquityUsd + p.vaults.btc.loopEquityUsd);
const carryPerDay = (p: Params) => (p.loop.collateralUsd * p.market.primeYield - p.loop.debtUsd * p.market.hollarRate) / 365;

/** a short run from a chain state with flat collateral and the PRIME drift the chain actually showed */
function replay(p: Params, primeYield: number): Params {
  const q = clone(p);
  q.sim.initial = "lark4";
  q.sim.horizonDays = 1;
  q.market.primeYield = primeYield;
  for (const k of ["eth", "btc"] as const) Object.assign(q.vaults[k], { vol: 0, drift: 0, inflowUsd: 0, outflowRate: 0, capOn: false });
  return q;
}

/** replay a testnet's history against the simulator: hole closure in quiet stretches, and each deposit's ramp cost */
export async function backtest(rpc: string, samples = 40) {
  const dep = DEPLOYMENTS[0];
  const head = (await loadLive(dep, rpc)).block;
  const pts: Sample[] = [];
  for (let i = 1; i <= samples; i++) {
    const block = Math.max(1, Math.round((head * i) / samples));
    try {
      const s = await loadLive(dep, rpc, block);
      const p = s.apply(clone(LARK4));
      pts.push({ block, t: s.timestamp, p, principal: p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal, hole: hole(p) });
    } catch {
      // before the contracts existed
    }
  }
  // collateral aTokens accrue, so "unchanged" allows a little drift and a deposit is a real step
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-4 * Math.max(1e-12, Math.abs(y));
  const quiet = (a: Sample, b: Sample) =>
    same(a.p.vaults.eth.units, b.p.vaults.eth.units) && same(a.p.vaults.btc.units, b.p.vaults.btc.units) &&
    Math.abs(b.p.loop.collateralUsd / a.p.loop.collateralUsd - 1) < 0.005 && Math.abs(b.p.loop.debtUsd / a.p.loop.debtUsd - 1) < 0.005;
  const levered = (s: Sample) => s.p.loop.debtUsd > 0 && (s.p.loop.collateralUsd * s.p.loop.primeLt) / s.p.loop.debtUsd < 1.1;
  // HOLLAR waiting to enter (cash or pending intents): the chain hasn't paid its entry yet
  const inFlight = (s: Sample) => s.p.vaults.eth.loopEquityUsd + s.p.vaults.btc.loopEquityUsd - (s.p.loop.collateralUsd - s.p.loop.debtUsd) > 1;
  // quiet stretches: consecutive quiet pairs on a levered loop
  const stretches: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (!quiet(pts[i], pts[i + 1]) || !levered(pts[i]) || inFlight(pts[i]) || inFlight(pts[i + 1])) continue;
    const last = stretches[stretches.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else stretches.push([i, i + 1]);
  }
  const carry = stretches.sort((x, y) => pts[y[1]].t - pts[y[0]].t - (pts[x[1]].t - pts[x[0]].t)).slice(0, 3).map(([i, j]) => {
    const a = pts[i];
    const b = pts[j];
    const days = (b.t - a.t) / 86400;
    const realized = Math.log(b.p.market.primePrice / a.p.market.primePrice) / (days / 365);
    const r = runPath(replay(a.p, realized), 0);
    const mc = (r.series[SERIES_INDEX.loopDeficit] / 1e4) * a.principal - a.hole;
    const chain = (b.hole - a.hole) / days;
    const hfChain = (b.p.loop.collateralUsd * b.p.loop.primeLt) / b.p.loop.debtUsd;
    return { from: a.block, to: b.block, days, primeYield: realized, chainHolePerDay: chain, mcHolePerDay: mc, errorPct: (mc / chain - 1) * 100, hfChain, hfMc: r.series[SERIES_INDEX.hf] };
  });
  // deposits: a vault's assets rose between two samples and nothing else moved them; measured once the ramp has landed
  // (cash still in pending intents isn't in the hole metric) and above $2k, where a few hours of carry is noise
  const deposits = [];
  const skipped = [];
  const atTarget = (s: Sample) => Math.abs((s.p.loop.collateralUsd * s.p.loop.primeLt) / s.p.loop.debtUsd - (s.p.loop.targetHf + s.p.loop.hfLag)) < 0.01;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!levered(a)) continue;
    for (const k of ["eth", "btc"] as const) {
      const other = k === "eth" ? "btc" : "eth";
      const added = b.p.vaults[k].units - a.p.vaults[k].units;
      if (!(added > 1e-3 * a.p.vaults[k].units) || !same(a.p.vaults[other].units, b.p.vaults[other].units)) continue;
      const days = (b.t - a.t) / 86400;
      const principalAdded = b.principal - a.principal;
      if (!atTarget(b) || inFlight(b) || inFlight(a) || principalAdded < 2000) {
        skipped.push({ from: a.block, to: b.block, vault: k, principalAdded, reason: atTarget(b) && !inFlight(b) && !inFlight(a) ? "under $2k" : "ramp still in flight" });
        continue;
      }
      const realized = Math.log(b.p.market.primePrice / a.p.market.primePrice) / Math.max(1e-9, days / 365);
      const q = replay(a.p, Number.isFinite(realized) ? realized : a.p.market.primeYield);
      q.vaults[k].units += added;
      q.vaults[k].price = b.p.vaults[k].price;
      // the chain borrows against a deposit's credit at the target LTV at once; a band check alone wouldn't
      q.vaults[k].bandLo = q.vaults[k].bandTarget - 1e-6;
      const r = runPath(q, 0);
      const chainCost = b.hole - a.hole + carryPerDay(a.p) * days;
      const mcCost = r.summary.entryCost / 365;
      deposits.push({
        from: a.block, to: b.block, vault: k, addedUnits: added, principalAdded,
        chainRampCostUsd: chainCost, chainBpsOfPrincipal: (chainCost / principalAdded) * 1e4,
        mcRampCostUsd: mcCost, mcPrimeBoughtUsd: r.summary.entryVolume / 365, mcBpsPerTrade: r.summary.entryAvgBps,
        // per $ of principal the ramp enters, the same basis as the chain figure
        mcBpsOfPrincipal: r.summary.entryAvgBps * leverage(q).L,
      });
    }
  }
  return { rpc, head, samples: pts.length, seriesLength: SERIES.length, carry, deposits, skipped };
}
