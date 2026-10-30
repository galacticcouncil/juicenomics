import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine/model/closedForm";
import { LARK4, clone } from "../src/engine/params/defaults";
import type { Params } from "../src/engine/params/types";
import { runPath } from "../src/engine/sim/mc";

const exits = (f: (p: Params) => void = () => {}) => {
  const p = clone(LARK4);
  p.sim.initial = "ramped";
  p.sim.horizonDays = 60;
  p.vaults.btc.vol = 0;
  p.vaults.btc.capOn = false;
  p.vaults.btc.outflowRate = 0.3;
  p.vaults.btc.inflowUsd = 0.3 * p.vaults.btc.units * p.vaults.btc.price;
  p.flows.sizeMedianUsd = 1000;
  p.flows.sizeSigma = 0;
  f(p);
  return p;
};

describe("headroom exits", () => {
  it("an exit with room settles without selling the loop, and the stayers keep its debt", () => {
    const on = runPath(exits(), 0).summary;
    const off = runPath(exits((p) => { p.policy.headroomOn = false; }), 0).summary;
    expect(on.exitsUsd).toBeGreaterThan(0);
    expect(on.headroomExitShare).toBeGreaterThan(0.9);
    expect(off.headroomExitShare).toBe(0);
    expect(on.headroomKeptUsd).toBeGreaterThan(0.6 * on.exitsUsd);
    expect(on.unwindVolume).toBeLessThan(0.2 * off.unwindVolume);
    expect(on.ltvAvgBtc).toBeGreaterThan(off.ltvAvgBtc);
    expect(on.exitWaitHours).toBeLessThanOrEqual(off.exitWaitHours);
    for (const s of [on, off]) expect(Math.abs(s.conservationGapUsd)).toBeLessThan(1e-6);
  });

  it("an exit that would leave the vault over max LTV takes the queue", () => {
    const p = exits((q) => { q.flows.sizeMedianUsd = 0.2 * q.vaults.btc.units * q.vaults.btc.price; });
    expect(runPath(p, 0).summary.headroomExitShare).toBe(0);
  });

  it("a shortfall settles from headroom only while the reserve covers it", () => {
    const hole = (reserve: number) => runPath(exits((p) => {
      p.sim.initial = "fresh";
      p.sim.horizonDays = 4;
      p.vaults.btc.outflowRate = 20;
      p.vaults.btc.inflowUsd = 0;
      p.flows.sizeMedianUsd = 500;
      p.policy.reserveUsd = reserve;
    }), 0).summary;
    const funded = hole(1000);
    const empty = hole(0);
    expect(funded.reserveDrawnUsd).toBeGreaterThan(0);
    expect(funded.reserveDrawnUsd).toBeLessThanOrEqual(1000 + 1e-9);
    expect(empty.reserveDrawnUsd).toBe(0);
    expect(funded.headroomExitShare).toBeGreaterThan(empty.headroomExitShare);
    for (const s of [funded, empty]) expect(Math.abs(s.conservationGapUsd)).toBeLessThan(1e-6);
  });

  it("the closed form spares the served exits' unwinds and lifts the stayers' LTV", () => {
    const p = exits((q) => { q.vaults.btc.vol = LARK4.vaults.btc.vol; q.vaults.btc.inflowUsd = 0; q.flows.sizeMedianUsd = 5000; });
    const on = evaluate(p);
    p.policy.headroomOn = false;
    const off = evaluate(p);
    expect(on.exits.headroomShare).toBeGreaterThan(0.3);
    expect(off.exits.headroomShare).toBe(0);
    expect(on.exits.unwindAvoidedUsd).toBeGreaterThan(0);
    expect(on.vaults.btc.avgLtv).toBeGreaterThan(off.vaults.btc.avgLtv);
    expect(on.vaults.btc.exitOneOff).toBeLessThan(off.vaults.btc.exitOneOff);
  });

  it("the closed form's served share tracks the Monte Carlo", () => {
    const p = exits((q) => { q.sim.horizonDays = 365; q.vaults.btc.vol = LARK4.vaults.btc.vol; q.vaults.btc.inflowUsd = 0; q.flows.sizeMedianUsd = 5000; });
    const runs = Array.from({ length: 12 }, (_, i) => runPath(p, i).summary);
    const pooled = runs.reduce((a, s) => a + s.headroomExitsUsd, 0) / runs.reduce((a, s) => a + s.exitsUsd, 0);
    expect(Math.abs(pooled - evaluate(p).exits.headroomShare)).toBeLessThan(0.1);
  });
});
