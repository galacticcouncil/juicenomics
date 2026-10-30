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
  it("a fresh ramp pays ~24.5 bps per entry at a 4 bps pool fee and ends ~c·L short, like the 16 Oct Lark 4", () => {
    const p = clone(LARK4);
    p.sim.initial = "fresh";
    p.sim.horizonDays = 3;
    p.pool.feeBps = 4;
    p.vaults.eth.vol = 0;
    p.vaults.btc.vol = 0;
    const r = runPath(p, 0);
    expect(r.summary.entryAvgBps).toBeGreaterThan(23.5);
    expect(r.summary.entryAvgBps).toBeLessThan(25.5);
    expect(r.summary.maxLoopDeficitBps).toBeGreaterThan(120);
    expect(r.summary.maxLoopDeficitBps).toBeLessThan(165);
    expect(r.summary.arbGross).toBeGreaterThan(0);
  });
  it("at the 1 bp launch fee an entry costs ~18.6 bps and the ramp ends ~c·L short", () => {
    const p = clone(LARK4);
    p.sim.initial = "fresh";
    p.sim.horizonDays = 3;
    p.vaults.btc.vol = 0;
    const r = runPath(p, 0).summary;
    expect(r.entryAvgBps).toBeGreaterThan(17.5);
    expect(r.entryAvgBps).toBeLessThan(19.5);
    expect(r.maxLoopDeficitBps).toBeGreaterThan(90);
    expect(r.maxLoopDeficitBps).toBeLessThan(125);
  });
  it("a vault that's off reports no APR, and jETH runs beside jBTC when on", () => {
    const p = clone(LARK4);
    p.sim.horizonDays = 30;
    const one = runPath(p, 0).summary;
    expect(Number.isNaN(one.aprEth)).toBe(true);
    expect(one.cohorts.every((c) => c.vault === "btc")).toBe(true);
    p.vaults.eth.on = true;
    const two = runPath(p, 0).summary;
    expect(Number.isFinite(two.aprEth)).toBe(true);
    expect(two.cohorts.some((c) => c.vault === "eth")).toBe(true);
  });
  for (const both of [false, true]) {
    it(`flat prices reproduce the closed-form APR within 0.4 pp${both ? ", jETH on" : ""}`, () => {
      const p = clone(LARK4);
      p.vaults.eth.on = both;
      p.vaults.eth.vol = 0;
      p.vaults.btc.vol = 0;
      const r = runPath(p, 0);
      const cf = evaluate(p);
      expect(Math.abs(r.summary.aprBtc - cf.vaults.btc.horizonApr)).toBeLessThan(0.004);
      if (both) expect(Math.abs(r.summary.aprEth - cf.vaults.eth.horizonApr)).toBeLessThan(0.004);
    });
  }
  it("with today's volatility the closed form tracks the simulation within ~0.6 pp", () => {
    const p = clone(LARK4);
    p.vaults.eth.on = true;
    p.policy.costReserveBps = 0;
    const runs = [0, 1, 2, 3].map((i) => runPath(p, i).summary);
    const mean = (f: (s: (typeof runs)[number]) => number) => runs.reduce((a, s) => a + f(s), 0) / runs.length;
    const cf = evaluate(p);
    expect(Math.abs(mean((s) => s.aprBtc) - cf.vaults.btc.horizonApr)).toBeLessThan(0.006);
    expect(Math.abs(mean((s) => s.aprEth) - cf.vaults.eth.horizonApr)).toBeLessThan(0.006);
  });
  it("entries keep to the lane's pacing: one tranche a minute", () => {
    const p = clone(LARK4);
    p.sim.initial = "fresh";
    p.sim.horizonDays = 1;
    p.vaults.btc.vol = 0;
    p.vaults.btc.units *= 20;
    p.vaults.btc.capOn = false;
    p.arb.inventoryPrime = 50_000_000;
    p.loop.budgetRefillPerSec = 1000;
    p.loop.budgetCap = 1e7;
    const paced = runPath(p, 0).summary.entryVolume / 365;
    expect(paced).toBeLessThanOrEqual(24 * 60 * p.loop.tranche * (1 + 1e-9));
    p.loop.paceSec = 0;
    expect(runPath(p, 0).summary.entryVolume / 365).toBeGreaterThan(paced * 1.2);
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
  const at = (m: number, days = 120) => {
    const p = clone(LARK4);
    p.sim.horizonDays = days;
    p.fees.loopDiscountCapUsd = 1e9;
    for (const k of ["eth", "btc"] as const) {
      p.vaults[k].units *= m; p.vaults[k].mainDebt *= m; p.vaults[k].loopPrincipal *= m; p.vaults[k].loopEquityUsd *= m; p.vaults[k].tvlCap = 1e9;
    }
    p.loop.collateralUsd *= m;
    p.loop.debtUsd *= m;
    return p;
  };
  it("APR falls as TVL outgrows pool 143, in both engines", () => {
    const run = (m: number) => { const p = at(m); return { cf: evaluate(p).vaults.btc.net, mc: runPath(p, 1).summary }; };
    const small = run(1);
    const big = run(20);
    expect(big.cf).toBeLessThan(small.cf - 0.0005);
    expect(big.mc.aprBtc).toBeLessThan(small.mc.aprBtc);
    expect(big.mc.minHf).toBeGreaterThan(1);
    expect(big.mc.entryAvgBps).toBeLessThan(40);
  });
  it("the closed form's netting keeps its drop with scale in step with the Monte Carlo (the NETTING fit)", () => {
    const drop = (m: number) => {
      const p = at(m, 365);
      p.sim.initial = "ramped";
      p.pool.feeBps = 2;
      p.policy.costReserveBps = 0;
      const mc = [0, 1, 2, 3, 4, 5, 6, 7].reduce((a, i) => a + runPath(p, i).summary.aprBtc, 0) / 8;
      return { cf: evaluate(p).vaults.btc.net, mc };
    };
    const small = drop(1);
    const big = drop(20);
    expect(Math.abs(small.cf - big.cf - (small.mc - big.mc))).toBeLessThan(0.0005);
    expect(Math.abs(big.cf - big.mc)).toBeLessThan(0.001);
  });
  it("the loop discount's dollar cap bites as TVL grows, in both engines", () => {
    const capped = (m: number) => {
      const p = at(m, 180);
      p.fees.loopDiscountCapUsd = LARK4.fees.loopDiscountCapUsd;
      p.sim.initial = "ramped";
      p.vaults.btc.vol = 0;
      return { cf: evaluate(p), mc: runPath(p, 0).summary };
    };
    const big = capped(20);
    expect(big.cf.rates.loopDiscounted).toBeLessThan(0.7);
    const debt = big.mc.hollarDebtStartUsd;
    expect(big.mc.hollarInterest).toBeGreaterThan(0.9 * big.cf.protocol.hollarInterest);
    expect(big.mc.hollarInterest).toBeLessThan(1.1 * big.cf.protocol.hollarInterest);
    expect(debt).toBeGreaterThan(LARK4.fees.loopDiscountCapUsd);
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
    p.sim.initial = "fresh";
    p.sim.horizonDays = 240;
    p.pool.feeBps = 4;
    p.policy.stopBps = 150;
    p.policy.resumeBps = 120;
    p.market.stress = "crash30";
    const stop = (day: number) => { p.market.stressDay = day; const s = runPath(p, 3).summary; return s.stopHoursBtc; };
    expect(stop(150)).toBe(0);
    expect(stop(2)).toBeGreaterThan(stop(150));
  });
});

describe("withdrawals", () => {
  const quiet = () => {
    const p = clone(LARK4);
    p.vaults.eth.on = true;
    p.sim.initial = "fresh";
    p.sim.horizonDays = 30;
    p.loop.mode = "lev";
    p.loop.leverage = 1;
    p.loop.solverBps = 0;
    p.market.primeYield = 0;
    p.market.hollarRate = 0;
    p.fees.protocolFeeBps = 0;
    p.improvements.desk = true;
    p.improvements.deskMode = "direct";
    p.flows.sizeMedianUsd = 2000;
    p.flows.sizeSigma = 0;
    for (const k of ["eth", "btc"] as const) { p.vaults[k].vol = 0; p.vaults[k].outflowRate = 20; }
    return p;
  };
  it("shares waiting out their cooldown keep their value", () => {
    const p = quiet();
    p.policy.cooldownHours = 720;
    const r = runPath(p, 0).summary;
    expect(r.withdrawnUsd).toBe(0);
    expect(r.cohorts.length).toBeGreaterThan(1);
    for (const c of r.cohorts) expect(c.apr).toBeCloseTo(0, 6);
  });
  it("unwinds still in flight at the horizon count at what they're owed", () => {
    const p = quiet();
    p.policy.headroomOn = false;
    p.policy.cooldownHours = 1;
    p.improvements.desk = false;
    p.loop.laneCapBps = 0.01;
    const r = runPath(p, 0).summary;
    expect(r.withdrawnUsd).toBe(0);
    for (const c of r.cohorts) expect(c.apr).toBeCloseTo(0, 6);
  });
  it("discrete requests leave room for price resizing between cooldowns", () => {
    const p = clone(LARK4);
    p.vaults.btc.outflowRate = 0.3;
    p.policy.cooldownHours = 12;
    expect(runPath(p, 0).summary.releversBtc + runPath(p, 0).summary.deleversBtc).toBeGreaterThan(0);
  });
});
