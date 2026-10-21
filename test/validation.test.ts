import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine/model/closedForm";
import { LARK4, clone } from "../src/engine/params/defaults";
import { preset } from "../src/engine/params/presets";
import type { Params } from "../src/engine/params/types";
import { runPath } from "../src/engine/sim/mc";

const variants: [string, (p: Params) => void][] = [
  ["fresh defaults", () => {}],
  ["current state", (p) => { p.sim.initial = "lark4"; }],
  ["steady state at 44× TVL", (p) => { p.sim.initial = "ramped"; for (const k of ["eth", "btc"] as const) { p.vaults[k].units *= 44; p.vaults[k].capOn = false; } }],
  ["mainnet launch", (p) => Object.assign(p, preset("mainnet"))],
  ["desk, own costs, growth, exits", (p) => {
    p.improvements.desk = true; p.improvements.deskMode = "direct"; p.improvements.attribution = "own";
    p.flows.growth = "exp"; p.flows.growthFactor = 3;
    for (const k of ["eth", "btc"] as const) { p.vaults[k].capOn = false; p.vaults[k].outflowRate = 0.5; }
  }],
  ["crash, matching, gross fee, deposit fee", (p) => {
    p.sim.initial = "lark4"; p.market.stress = "crash30"; p.improvements.matching = true; p.fees.feeBase = "gross";
    p.depositFee.on = true; p.depositFee.dest = "protocol"; p.depositFee.bps = 20;
    p.vaults.btc.outflowRate = 1; p.vaults.btc.inflowUsd = 100_000; p.vaults.btc.capOn = false;
  }],
  ["incentive, swing pricing", (p) => { p.improvements.incentiveBps = 100; p.improvements.attribution = "swing"; p.vaults.eth.inflowUsd = 50_000; p.vaults.eth.capOn = false; }],
];

describe("the books close", () => {
  for (const [name, f] of variants) {
    it(name, () => {
      const p = clone(LARK4);
      f(p);
      p.sim.horizonDays = 120;
      const s = runPath(p, 1).summary;
      expect(Math.abs(s.conservationGapUsd)).toBeLessThan(1e-9 * Math.max(1, s.primeYieldUsd) + 1e-6);
    });
  }
});

describe("steady state", () => {
  it("a ramped start at flat prices earns the closed form's net APR", () => {
    const p = clone(LARK4);
    p.sim.initial = "ramped";
    p.policy.costReserveBps = 0;
    for (const k of ["eth", "btc"] as const) p.vaults[k].vol = 0;
    const s = runPath(p, 0).summary;
    const cf = evaluate(p);
    expect(Math.abs(s.aprBtc - cf.vaults.btc.net)).toBeLessThan(0.003);
    expect(Math.abs(s.aprEth - cf.vaults.eth.net)).toBeLessThan(0.003);
  });
  it("starts with the HOLLAR the closed form says it owes", () => {
    const p = clone(LARK4);
    p.sim.initial = "ramped";
    p.sim.horizonDays = 5;
    for (const k of ["eth", "btc"] as const) p.vaults[k].vol = 0;
    const s = runPath(p, 0).summary;
    const cf = evaluate(p);
    expect(s.hollarDebtStartUsd / cf.hollar.debtUsd).toBeGreaterThan(0.98);
    expect(s.hollarDebtStartUsd / cf.hollar.debtUsd).toBeLessThan(1.04);
  });
});

describe("headless cli", () => {
  const sim = (...args: string[]) => JSON.parse(execFileSync("node_modules/.bin/tsx", ["scripts/sim.mts", ...args], { encoding: "utf8", timeout: 60_000 }));
  it("cf and mc print JSON that agrees with the engine", () => {
    const cf = sim("cf", "--set", "loop.mode=lev", "--set", "loop.leverage=3");
    expect(cf.leverage).toBeCloseTo(3, 6);
    const mc = sim("mc", "--paths", "4", "--horizon", "10", "--workers", "2", "--fields", "aprBtc,conservationGapUsd");
    expect(mc.paths).toBe(4);
    expect(Math.abs(mc.mc.conservationGapUsd.mean)).toBeLessThan(1e-3);
  });
  it("links round-trip through the cli", () => {
    const made = sim("link", "--set", "pool.feeBps=2");
    const back = sim("link", made.link);
    expect(back.diff).toEqual(made.diff);
  });
});
