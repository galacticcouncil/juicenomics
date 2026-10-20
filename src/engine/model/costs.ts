import type { Params } from "../params/types";
import { shortfallBps, type PoolState } from "../pool/fastPool";

export interface CostBreakdown {
  /** arb's sell threshold: how rich the pool rests while the loop buys */
  bandBps: number;
  impactBps: number;
  feeBps: number;
  solverBps: number;
  /** entry cost via outside arbs */
  entryArbBps: number;
  unwindArbBps: number;
  /** entry cost via the treasury desk */
  entryDeskBps: number;
  unwindDeskBps: number;
  deskCoverage: number;
  /** what the model uses */
  entryBps: number;
  unwindBps: number;
  /** arb's cost of its other leg per unit sold, bps (realistic mode) */
  arbOtherLegBps: number;
  stall: boolean;
}

export function poolState(p: Params): PoolState {
  return { prime: p.pool.prime, hollar: p.pool.hollar, peg: p.market.primePrice, amp: p.pool.amp, fee: p.pool.feeBps / 1e4 };
}

/** HOLLAR exit cost for a given size, linear between the 10k and 100k quotes */
export function exitBps(p: Params, usd: number): number {
  const { exit10kBps: e10, exit100kBps: e100 } = p.arb;
  if (usd <= 10_000) return e10;
  return e10 + ((e100 - e10) * (usd - 10_000)) / 90_000;
}

export function arbSellThreshold(p: Params): { band: number; otherLeg: number } {
  if (p.arb.mode === "fixed") return { band: p.arb.sellBps, otherLeg: 0 };
  const otherLeg = exitBps(p, p.arb.tradeUsd) + (p.arb.fixedUsd / p.arb.tradeUsd) * 1e4;
  return { band: otherLeg + p.arb.marginBps, otherLeg };
}

/** price impact of one entry tranche alone, excluding the fee */
export function trancheImpactBps(p: Params): number {
  const s = poolState(p);
  const balanced = { ...s, hollar: s.prime * s.peg };
  const fee = balanced.fee;
  balanced.fee = 0;
  const small = shortfallBps(balanced, 1, 1, s.peg);
  const full = shortfallBps(balanced, 1, p.loop.tranche, s.peg);
  balanced.fee = fee;
  return Math.max(0, full - small);
}

export function costs(p: Params, primeDemandUsd: number): CostBreakdown {
  const fee = p.pool.feeBps;
  const solver = p.loop.solverBps;
  const impact = trancheImpactBps(p);
  const { band, otherLeg } = arbSellThreshold(p);
  const entryArb = band + 2 * fee + impact + solver;
  // a full unwind recaptures part of the rich pool's premium; fitted to the pool-143 fee sweep
  const unwindArb = Math.max(-band, 3.21 - 0.14 * (band - 15)) + 1.69 * fee;
  const im = p.improvements;
  const entryDesk = im.deskMode === "direct" ? im.deskSpreadBps + solver : im.deskSpreadBps + fee + impact + solver;
  const unwindDesk = im.deskBid ? (im.deskMode === "direct" ? im.deskSpreadBps : im.deskSpreadBps + fee + impact) : unwindArb;
  const coverage = im.desk ? (primeDemandUsd <= 0 ? 1 : Math.min(1, (im.deskPrime * p.market.primePrice) / primeDemandUsd)) : 0;
  let entry = coverage * entryDesk + (1 - coverage) * entryArb;
  let unwind = coverage * unwindDesk + (1 - coverage) * unwindArb;
  if (p.costs.mode === "manual") {
    entry = p.costs.entryBps;
    unwind = p.costs.unwindBps;
  }
  return {
    bandBps: band,
    impactBps: impact,
    feeBps: fee,
    solverBps: solver,
    entryArbBps: entryArb,
    unwindArbBps: unwindArb,
    entryDeskBps: entryDesk,
    unwindDeskBps: unwindDesk,
    deskCoverage: coverage,
    entryBps: entry,
    unwindBps: unwind,
    arbOtherLegBps: otherLeg,
    stall: entry > p.loop.laneCapBps,
  };
}
