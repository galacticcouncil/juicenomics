import { expect, it } from "vitest";
import { LARK4, clone } from "../src/engine/params/defaults";
import { runPath, SERIES, SERIES_INDEX } from "../src/engine/sim/mc";
import { evaluate } from "../src/engine/model/closedForm";
import * as wasm from "@galacticcouncil/math-stableswap";
import { fastPool, wasmPool, type StableswapWasm } from "../src/engine/pool/pool";

it("a pool trade debits the tokens actually sent to its recipient", () => {
  const state = { prime: 455929.149, hollar: 586779.025, peg: 1.06559018, amp: 100, fee: 0.0004 };
  const fast = fastPool({ ...state });
  const exact = wasmPool({ ...state }, wasm as unknown as StableswapWasm);
  const out = fast.apply(1, 2500);
  const exactOut = exact.apply(1, 2500);
  expect(state.prime - fast.state.prime).toBeCloseTo(out, 8);
  expect(fast.state.prime).toBeCloseTo(exact.state.prime, 1);
  expect(out).toBeCloseTo(exactOut, 1);
});

it("fast and exact execution agree on a full default path", () => {
  const p = clone(LARK4);
  const fast = runPath(p, 0).summary;
  p.sim.poolMode = "exact";
  const exact = runPath(p, 0, wasm as unknown as StableswapWasm).summary;
  expect(fast.aprBtc).toBeCloseTo(exact.aprBtc, 4);
});

it("a queued withdrawal retains its value until it settles", () => {
  const p = clone(LARK4);
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
  p.policy.cooldownHours = 720;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].outflowRate = 1;
  }
  const r = runPath(p, 0);
  expect(r.summary.withdrawnUsd).toBe(0);
  expect(r.summary.aprBtc).toBeCloseTo(0, 8);
  expect(r.summary.cohorts[1].apr).toBeCloseTo(0, 8);
});

it("a 30-day run accrues exactly 30 days at every accepted time step", () => {
  const p = clone(LARK4);
  p.sim.horizonDays = 30;
  p.sim.stepHours = 16;
  p.vaults.eth.vol = 0;
  p.vaults.btc.vol = 0;
  const r = runPath(p, 0);
  const actual = r.series[(r.days - 1) * SERIES.length + SERIES_INDEX.prime];
  const expected = p.market.primePrice * Math.exp(p.market.primeYield * 30 / 365);
  expect(actual).toBeCloseTo(expected, 6);
});

it("fee on net yield differs from fee on the whole harvest", () => {
  const p = clone(LARK4);
  p.vaults.eth.vol = 0;
  p.vaults.btc.vol = 0;
  p.fees.protocolFeeBps = 9000;
  const contract = runPath(p, 0).summary;
  p.fees.feeBase = "yield";
  const net = runPath(p, 0).summary;
  expect(net.aprBtc).toBeGreaterThan(contract.aprBtc + 0.01);
});

it("rebalance monitoring changes the Monte Carlo rebalance schedule", () => {
  const p = clone(LARK4);
  p.market.monitorMinutes = 1;
  const fast = runPath(p, 0).summary;
  p.market.monitorMinutes = 1440;
  const slow = runPath(p, 0).summary;
  expect(slow.releversBtc).not.toBe(fast.releversBtc);
});

it("direct desk fills do not generate stableswap fees", () => {
  const p = clone(LARK4);
  p.improvements.desk = true;
  p.improvements.deskMode = "direct";
  p.improvements.deskPrime = 50_000_000;
  const r = evaluate(p);
  expect(r.costs.deskCoverage).toBe(1);
  expect(r.protocol.lpFees).toBe(0);
});

it("100% performance fees cannot give a positive user break-even under net-negative carry", () => {
  const p = clone(LARK4);
  p.fees.protocolFeeBps = 10_000;
  p.vaults.eth.vol = 0;
  p.vaults.btc.vol = 0;
  const r = evaluate(p);
  expect(r.vaults.btc.net).toBeLessThan(0);
  expect(r.breakEven.entryDays).toBe(Infinity);
});

it("own entry costs do not reduce the incumbent cohort's wealth", () => {
  const p = clone(LARK4);
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
  p.improvements.deskSpreadBps = 10;
  p.improvements.attribution = "own";
  p.flows.sizeMedianUsd = 1000;
  p.flows.sizeSigma = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].capOn = false;
  }
  const base = runPath(p, 0).summary;
  p.vaults.btc.inflowUsd = 500_000;
  const flow = runPath(p, 0).summary;
  const baseOld = base.cohorts.find(c => c.vault === "btc" && c.day === 0)!.apr;
  const flowOld = flow.cohorts.find(c => c.vault === "btc" && c.day === 0)!.apr;
  expect(flowOld).toBeGreaterThanOrEqual(baseOld - 1e-8);
});
