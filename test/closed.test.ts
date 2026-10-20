import { describe, expect, it } from "vitest";
import { LARK4, clone } from "../src/engine/params/defaults";
import type { Params } from "../src/engine/params/types";
import { evaluate } from "../src/engine/model/closedForm";
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

  it("entry break-even is ~55 days at a 1.63% spread and doesn't depend on leverage", () => {
    for (const L of [2, 3, 6.05]) {
      const r = evaluate(study((p) => { p.loop.leverage = L; p.market.primeYield = 0.0603; p.costs.mode = "manual"; p.costs.entryBps = 24.5; }));
      expect(r.breakEven.entryDays).toBeGreaterThan(53);
      expect(r.breakEven.entryDays).toBeLessThan(57);
    }
  });

  it("+1% supply APY takes the entry break-even to ~34 days", () => {
    const r = evaluate(study((p) => { p.market.primeYield = 0.0603; p.improvements.incentiveBps = 100; p.costs.mode = "manual"; p.costs.entryBps = 24.5; }));
    expect(r.breakEven.entryDays).toBeGreaterThan(32);
    expect(r.breakEven.entryDays).toBeLessThan(36);
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
  it("derived entry cost at Lark 4 is ~24.5 bps, realistic arb ~28.4 and stalls at the 27 bps cap", () => {
    const r = evaluate(clone(LARK4));
    expect(r.costs.entryBps).toBeGreaterThan(24);
    expect(r.costs.entryBps).toBeLessThan(25);
    expect(r.costs.stall).toBe(false);
    const p = clone(LARK4);
    p.arb.mode = "realistic";
    const q = evaluate(p);
    expect(q.costs.entryBps).toBeGreaterThan(27.9);
    expect(q.costs.entryBps).toBeLessThan(28.8);
    expect(q.costs.stall).toBe(true);
  });
  it("Lark 4 leverage ~6.05× and today's hole ~$1.18k", () => {
    const r = evaluate(clone(LARK4));
    expect(r.lev.L).toBeGreaterThan(6.0);
    expect(r.lev.L).toBeLessThan(6.1);
    expect(r.lark4Now.holeUsd).toBeGreaterThan(1000);
    expect(r.lark4Now.holeUsd).toBeLessThan(1400);
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
