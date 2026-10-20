import { describe, expect, it } from "vitest";
import * as wasm from "@galacticcouncil/math-stableswap";
import { LARK4, clone } from "../src/engine/params/defaults";
import { evaluate } from "../src/engine/model/closedForm";
import { quote, type PoolState } from "../src/engine/pool/fastPool";
import { wasmPool, type StableswapWasm } from "../src/engine/pool/pool";
import { runPath } from "../src/engine/sim/mc";

const math = wasm as unknown as StableswapWasm;

describe("pool 143 math", () => {
  it("the float mirror matches Hydration's wasm within 0.05 bps", () => {
    for (const [prime, hollar] of [[455_929, 586_779], [600_000, 450_000], [300_000, 900_000]]) {
      const s: PoolState = { prime, hollar, peg: 1.06559, amp: 100, fee: 0.0004 };
      const exact = wasmPool({ ...s }, math);
      for (const [side, amt] of [[1, 2500], [1, 50_000], [0, 2000], [0, 40_000]] as const) {
        const a = quote(s, side, amt);
        const b = exact.quote(side, amt);
        expect(Math.abs(a / b - 1) * 1e4, `${prime}/${hollar} side ${side} ${amt}`).toBeLessThan(0.05);
      }
    }
  });
  it("a 2,500 HOLLAR entry at the Lark 4 pool costs ~23.5 bps before the solver", () => {
    const s: PoolState = { prime: 455_929.149, hollar: 586_779.025, peg: 1.06559018, amp: 100, fee: 0.0004 };
    const out = quote(s, 1, 2500);
    const bps = (1 - (out * s.peg) / 2500) * 1e4;
    expect(bps).toBeGreaterThan(22.5);
    expect(bps).toBeLessThan(24.5);
  });
});

describe("monte carlo", () => {
  it("a fresh ramp pays ~24.5 bps per entry and ends ~c·L short, like Lark 4", () => {
    const p = clone(LARK4);
    p.sim.initial = "fresh";
    p.sim.horizonDays = 3;
    p.vaults.eth.vol = 0;
    p.vaults.btc.vol = 0;
    const r = runPath(p, 0);
    expect(r.summary.entryAvgBps).toBeGreaterThan(23.5);
    expect(r.summary.entryAvgBps).toBeLessThan(25.5);
    expect(r.summary.maxLoopDeficitBps).toBeGreaterThan(120);
    expect(r.summary.maxLoopDeficitBps).toBeLessThan(165);
    expect(r.summary.arbGross).toBeGreaterThan(0);
  });
  it("flat prices reproduce the closed-form APR within 0.4 pp", () => {
    const p = clone(LARK4);
    p.vaults.eth.vol = 0;
    p.vaults.btc.vol = 0;
    const r = runPath(p, 0);
    const cf = evaluate(p);
    expect(Math.abs(r.summary.aprBtc - cf.vaults.btc.net)).toBeLessThan(0.004);
    expect(Math.abs(r.summary.aprEth - cf.vaults.eth.net)).toBeLessThan(0.004);
  });
  it("with today's volatility the closed form tracks the simulation within ~0.6 pp", () => {
    const p = clone(LARK4);
    p.policy.costReserveBps = 0;
    const runs = [0, 1, 2, 3].map((i) => runPath(p, i).summary);
    const mean = (f: (s: (typeof runs)[number]) => number) => runs.reduce((a, s) => a + f(s), 0) / runs.length;
    const cf = evaluate(p);
    expect(Math.abs(mean((s) => s.aprBtc) - cf.vaults.btc.net)).toBeLessThan(0.006);
    expect(Math.abs(mean((s) => s.aprEth) - cf.vaults.eth.net)).toBeLessThan(0.006);
  });
  it("same seed, same path", () => {
    const p = clone(LARK4);
    p.sim.horizonDays = 30;
    const a = runPath(p, 3);
    const b = runPath(p, 3);
    expect(a.summary.aprBtc).toBe(b.summary.aprBtc);
    expect(Array.from(a.series.slice(0, 50))).toEqual(Array.from(b.series.slice(0, 50)));
  });
  it("an empty arb stalls entries at the lane cap", () => {
    const p = clone(LARK4);
    p.sim.initial = "fresh";
    p.sim.horizonDays = 5;
    p.arb.inventoryPrime = 0;
    p.arb.refillHours = 0;
    p.vaults.eth.vol = 0;
    p.vaults.btc.vol = 0;
    expect(runPath(p, 0).summary.stallHours).toBeGreaterThan(24);
  });
});

describe("scale", () => {
  it("APR falls as TVL outgrows pool 143, in both engines", () => {
    const at = (m: number) => {
      const p = clone(LARK4);
      p.sim.horizonDays = 120;
      for (const k of ["eth", "btc"] as const) {
        p.vaults[k].units *= m; p.vaults[k].mainDebt *= m; p.vaults[k].loopPrincipal *= m; p.vaults[k].loopEquityUsd *= m; p.vaults[k].tvlCap = 1e9;
      }
      p.loop.collateralUsd *= m;
      p.loop.debtUsd *= m;
      return { cf: evaluate(p).vaults.btc.net, mc: runPath(p, 1).summary };
    };
    const small = at(1);
    const big = at(20);
    expect(big.cf).toBeLessThan(small.cf - 0.003);
    expect(big.mc.aprBtc).toBeLessThan(small.mc.aprBtc);
    expect(big.mc.minHf).toBeGreaterThan(1);
    expect(big.mc.entryAvgBps).toBeLessThan(40);
  });
});

describe("harvest", () => {
  it("keeps harvesting while exits are queued", () => {
    const p = clone(LARK4);
    p.sim.horizonDays = 150;
    p.flows.growth = "exp";
    p.flows.growthFactor = 10;
    p.policy.costReserveBps = 0;
    for (const k of ["eth", "btc"] as const) { p.vaults[k].tvlCap = 1e9; p.vaults[k].outflowRate = 0.3; }
    expect(runPath(p, 0).summary.endLoopDeficitBps).toBeGreaterThan(-30);
  });
  it("keeps the execution-cost allowance as surplus, about allowance × L", () => {
    const p = clone(LARK4);
    p.vaults.eth.vol = 0;
    p.vaults.btc.vol = 0;
    const end = runPath(p, 0).summary.endLoopDeficitBps;
    expect(end).toBeLessThan(-0.8 * p.policy.costReserveBps * 6);
    expect(end).toBeGreaterThan(-1.2 * p.policy.costReserveBps * 6);
  });
  it("a crash hurts while the entry hole is open, not after", () => {
    const p = clone(LARK4);
    p.sim.horizonDays = 240;
    p.market.stress = "crash30";
    const stop = (day: number) => { p.market.stressDay = day; const s = runPath(p, 3).summary; return s.stopHoursEth + s.stopHoursBtc; };
    expect(stop(150)).toBe(0);
    expect(stop(10)).toBeGreaterThan(stop(150));
  });
});
