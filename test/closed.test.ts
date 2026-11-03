import { describe, expect, it } from "vitest";
import { LARK0, LARK4, clone } from "../src/engine/params/defaults";
import type { Params } from "../src/engine/params/types";
import { cappedShare, evaluate } from "../src/engine/model/closedForm";
import { bands } from "../src/engine/model/bands";
import { PARAMS } from "../src/engine/params/schema";

// the study's simplified setting: fixed LTV, 6.05× by hand, no churn, fee on gross yield
function study(over: (p: Params) => void = () => {}): Params {
  const p = clone(LARK4);
  p.loop.mode = "lev";
  p.loop.leverage = 6.05;
  p.market.primeYield = 0.0593;
  p.market.hollarRate = 0.044;
  p.fees.feeBase = "gross";
  p.fees.protocolFeeBps = 500;
  p.fees.discountMain = 0;
  p.fees.discountLoop = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].bandTarget = 0.785;
    p.vaults[k].bandLo = 0.735;
    p.vaults[k].bandHi = 0.815;
  }
  over(p);
  return p;
}

describe("closed form vs the 20 Oct loop-cost study", () => {
  it("base APR is 6.9% at 0.785 LTV, 6.05×, 5.93% vs 4.40%, 5% fee", () => {
    const r = evaluate(study());
    expect(r.vaults.btc.net).toBeCloseTo(0.069, 3);
  });

  it("the hole is repaid in ~55 days at a 1.63% spread, whatever the leverage", () => {
    for (const L of [2, 3, 6.05]) {
      const r = evaluate(study((p) => { p.loop.leverage = L; p.market.primeYield = 0.0603; p.costs.mode = "manual"; p.costs.entryBps = 24.5; }));
      expect(r.breakEven.holeDays).toBeGreaterThan(53);
      expect(r.breakEven.holeDays).toBeLessThan(57);
    }
  });

  it("+1% supply APY repays the hole in ~34 days", () => {
    const r = evaluate(study((p) => { p.market.primeYield = 0.0603; p.improvements.incentiveBps = 100; p.costs.mode = "manual"; p.costs.entryBps = 24.5; }));
    expect(r.breakEven.holeDays).toBeGreaterThan(32);
    expect(r.breakEven.holeDays).toBeLessThan(36);
  });

  it("discount table: protocol HOLLAR interest 20.9% / 10.4% / 0 of collateral", () => {
    for (const [d, want] of [[0, 0.209], [0.5, 0.1045], [1, 0]] as const) {
      const r = evaluate(study((p) => { p.fees.discountMain = d; p.fees.discountLoop = d; }));
      expect(r.vaults.btc.mainInterest + r.vaults.btc.loopInterest).toBeCloseTo(want, 3);
    }
  });

  it("leverage table: liquidation drop 43 / 24 / 14 / 5%", () => {
    for (const [L, drop] of [[2, 0.43], [3, 0.24], [4, 0.14], [6.05, 0.047]] as const) {
      const r = evaluate(study((p) => { p.loop.leverage = L; }));
      expect(r.lev.liqDrop).toBeCloseTo(drop, 1);
    }
  });
});

describe("band churn vs the Monte Carlo of 20 Oct", () => {
  const churn = (lo: number, t: number, hi: number, vol: number, entry: number) => {
    const p = clone(LARK4);
    p.loop.mode = "lev";
    p.loop.leverage = 6.05;
    p.costs.mode = "manual";
    p.costs.entryBps = entry;
    p.costs.unwindBps = 8.5;
    p.costs.churnModel = "constant";
    p.improvements.attribution = "own";
    p.market.monitorMinutes = 15;
    Object.assign(p.vaults.btc, { bandLo: lo, bandTarget: t, bandHi: hi, vol });
    return evaluate(p).vaults.btc;
  };
  it("today's bands at 45% vol cost ~3.0%/yr, ~81 rebalances", () => {
    const v = churn(0.75, 0.8, 0.83, 0.45, 24.5);
    expect(v.churn).toBeGreaterThan(0.0285);
    expect(v.churn).toBeLessThan(0.032);
    expect(v.bands.eventsPerYear).toBeGreaterThan(75);
    expect(v.bands.eventsPerYear).toBeLessThan(87);
  });
  it("k scales with σ²: 35% → ~1.8%, 60% → ~5.3%", () => {
    expect(churn(0.75, 0.8, 0.83, 0.35, 24.5).churn).toBeCloseTo(0.0183, 2);
    expect(churn(0.75, 0.8, 0.83, 0.6, 24.5).churn).toBeCloseTo(0.0528, 2);
  });
  it("wide bands and the treasury desk cut it", () => {
    expect(churn(0.65, 0.75, 0.83, 0.45, 24.5).churn).toBeCloseTo(0.0117, 2);
    expect(churn(0.75, 0.8, 0.83, 0.45, 5).churn).toBeCloseTo(0.0125, 2);
  });
  it("average LTV 79.3 / 74.1 / 69.0%", () => {
    const avg = (lo: number, t: number) => bands({ lo, target: t, hi: 0.83, vol: 0.45, drift: 0, monitorYears: 0 }).avgLtv;
    expect(avg(0.75, 0.8)).toBeCloseTo(0.793, 2);
    expect(avg(0.65, 0.75)).toBeCloseTo(0.741, 2);
    expect(avg(0.55, 0.7)).toBeCloseTo(0.69, 2);
  });
});

describe("defaults", () => {
  it("derived entry cost is ~24.5 bps at mainnet's 4 bps pool fee, as measured on the 16 Oct Lark 4; realistic arb ~28.4 stalls at the 27 bps cap", () => {
    const p = clone(LARK4);
    p.pool.feeBps = 4;
    const r = evaluate(p);
    expect(r.costs.entryBps).toBeGreaterThan(24);
    expect(r.costs.entryBps).toBeLessThan(25);
    expect(r.costs.stall).toBe(false);
    p.arb.mode = "realistic";
    const q = evaluate(p);
    expect(q.costs.entryBps).toBeGreaterThan(27.9);
    expect(q.costs.entryBps).toBeLessThan(28.8);
    expect(q.costs.stall).toBe(true);
  });
  it("Lark 4's 1 bp launch fee cuts it to ~18.5 bps, and a realistic arb fits under the cap", () => {
    const r = evaluate(clone(LARK4));
    expect(LARK4.pool.feeBps).toBe(1);
    expect(r.costs.entryBps).toBeGreaterThan(18);
    expect(r.costs.entryBps).toBeLessThan(19);
    const p = clone(LARK4);
    p.arb.mode = "realistic";
    expect(evaluate(p).costs.stall).toBe(false);
  });
  it("Lark 4 runs jBTC alone at the release's band, fee and discounts", () => {
    expect(LARK4.vaults.btc.on).toBe(true);
    expect(LARK4.vaults.eth.on).toBe(false);
    expect([LARK4.vaults.btc.bandLo, LARK4.vaults.btc.bandTarget, LARK4.vaults.btc.bandHi]).toEqual([0.65, 0.75, 0.83]);
    expect(LARK4.fees.protocolFeeBps).toBe(6900);
    expect([LARK4.fees.discountMain, LARK4.fees.discountLoop, LARK4.fees.loopDiscountCapUsd]).toEqual([0.4, 0.9, 5_000_000]);
    expect(LARK4.policy.headroomOn).toBe(true);
    const r = evaluate(clone(LARK4));
    expect(r.active).toEqual(["btc"]);
    expect(r.totals.tvlUsd).toBeCloseTo(r.vaults.btc.tvlUsd, 6);
  });
  it("Lark 0 runs jETH alone on GIGAETH at the same band, fee and discounts, with its own lane and the Lark 60 s delay", () => {
    expect(LARK0.deployment).toBe("lark0");
    expect(LARK0.vaults.eth.on).toBe(true);
    expect(LARK0.vaults.btc.on).toBe(false);
    expect(LARK0.vaults.eth.maxLtv).toBe(0.8);
    expect([LARK0.vaults.eth.bandLo, LARK0.vaults.eth.bandTarget, LARK0.vaults.eth.bandHi]).toEqual([0.65, 0.75, 0.83]);
    expect(LARK0.vaults.eth.tvlCap).toBe(100);
    expect(LARK0.fees.protocolFeeBps).toBe(6900);
    expect([LARK0.fees.discountMain, LARK0.fees.discountLoop, LARK0.fees.loopDiscountCapUsd]).toEqual([0.4, 0.9, 5_000_000]);
    expect([LARK0.policy.headroomOn, LARK0.policy.headroomGapBps, LARK0.policy.admissionBps, LARK0.policy.reserveUsd]).toEqual([true, 0, 250, 1000]);
    expect(LARK0.policy.cooldownHours * 3600).toBeCloseTo(60, 9);
    expect(LARK0.policy.costReserveBps).toBe(35);
    expect([LARK0.loop.laneCapBps, LARK0.loop.tranche, LARK0.loop.budgetCap, LARK0.loop.budgetRefillPerSec, LARK0.loop.paceSec]).toEqual([35, 2500, 25_000, 10, 60]);
    expect([LARK4.loop.laneCapBps, LARK4.loop.budgetRefillPerSec]).toEqual([27, 50]);
    const r = evaluate(clone(LARK0));
    expect(r.active).toEqual(["eth"]);
    expect(r.vaults.eth.netWithInKind - r.vaults.eth.net).toBeCloseTo(0.015, 9);
    expect(r.issues).toEqual([]);
  });
  it("Lark 4 leverage ~6.06× and today's hole is principal less equityOf", () => {
    const r = evaluate(clone(LARK4));
    expect(r.lev.L).toBeGreaterThan(6.0);
    expect(r.lev.L).toBeLessThan(6.1);
    const v = LARK4.vaults.btc;
    expect(r.lark4Now.holeUsd).toBeCloseTo(v.loopPrincipal - Math.max(LARK4.loop.collateralUsd - LARK4.loop.debtUsd, v.loopEquityUsd), 6);
  });
  it("the loop discount covers only the loop debt under its cap", () => {
    const p = clone(LARK4);
    const small = evaluate(p).rates;
    expect(small.loopDiscounted).toBeCloseTo(1, 6);
    expect(small.rLoop).toBeCloseTo(p.market.hollarRate * 0.1, 6);
    p.vaults.btc.units *= 40;
    p.vaults.btc.capOn = false;
    const big = evaluate(p).rates;
    expect(big.loopDiscounted).toBeLessThan(1);
    expect(big.rLoop).toBeCloseTo(p.market.hollarRate * (1 - 0.9 * big.loopDiscounted), 9);
    expect(cappedShare(10e6, 5e6, 0, 1)).toBeCloseTo(0.5, 12);
    expect(cappedShare(10e6, 5e6, 0.4, 1)).toBeLessThan(0.5);
    expect(cappedShare(4e6, 5e6, 0.4, 1)).toBeLessThan(1);
    expect(cappedShare(4e6, 5e6, 1e-6, 1)).toBeCloseTo(1, 9);
  });
  it("param codes and paths are unique and every path exists", () => {
    const codes = new Set(PARAMS.map((p) => p.code));
    expect(codes.size).toBe(PARAMS.length);
    for (const d of PARAMS) {
      const val = d.path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], LARK4);
      expect(val, d.path).not.toBeUndefined();
    }
  });
});

describe("growth", () => {
  const grow = (g: number, f?: (p: Params) => void) => {
    const p = clone(LARK4);
    p.flows.growth = "exp";
    p.flows.growthFactor = g;
    for (const k of ["eth", "btc"] as const) p.vaults[k].capOn = false;
    f?.(p);
    return evaluate(p);
  };
  it("an incumbent pays ln(g) of its entry for pooled exponential growth, not g − 1", () => {
    const r = grow(10, (p) => { p.costs.churnModel = "constant"; p.fees.protocolFeeBps = 0; });
    const want = Math.log(10) * r.vaults.btc.entryOneOff;
    expect(r.vaults.btc.flows).toBeGreaterThan(0.9 * want);
    expect(r.vaults.btc.flows).toBeLessThan(1.1 * want);
  });
  it("dollar figures use the average TVL: (g − 1) / ln g for exponential growth", () => {
    const r = grow(10);
    expect(r.totals.avgTvlUsd / r.totals.tvlUsd).toBeCloseTo(9 / Math.log(10), 1);
    expect(r.totals.endTvlUsd / r.totals.tvlUsd).toBeCloseTo(10, 0);
  });
  it("the vault caps stop growth", () => {
    const r = grow(10, (p) => { for (const k of ["eth", "btc"] as const) { p.vaults[k].capOn = true; p.vaults[k].on = true; } });
    for (const k of ["eth", "btc"] as const) expect(r.vaults[k].avgTvlUsd).toBeLessThanOrEqual(LARK4.vaults[k].tvlCap * LARK4.vaults[k].price * (1 + 1e-9));
  });
});
