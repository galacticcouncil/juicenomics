import { expect, it } from "vitest";
import { LARK4, clone } from "../src/engine/params/defaults";
import { evaluate } from "../src/engine/model/closedForm";
import { runPath } from "../src/engine/sim/mc";

it("linear growth dollar costs reconcile to the modeled trade volume", () => {
  const p = clone(LARK4);
  p.flows.growth = "linear";
  p.flows.growthFactor = 10;
  p.costs.churnModel = "constant";
  p.market.primeYield = 0;
  p.market.hollarRate = 0;
  p.fees.protocolFeeBps = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].capOn = false;
    p.vaults[k].vol = 0;
  }
  const r = evaluate(p);
  const volume = Object.values(r.vaults).reduce((a, v) => a + v.usd.entryVolume, 0);
  const cost = volume * r.costs.entryBps / 1e4;
  const booked = Object.values(r.vaults).reduce((a, v) => a + v.usd.flowCost, 0);
  expect(booked).toBeCloseTo(cost, 6);
});

it("gross fees on cash-matched exits include the claimant's prior entry costs", () => {
  const p = clone(LARK4);
  p.sim.horizonDays = 90;
  p.sim.stepHours = 24;
  p.market.monitorMinutes = 1440;
  p.loop.mode = "lev";
  p.loop.leverage = 1;
  p.loop.solverBps = 0;
  p.market.hollarRate = 0;
  p.costs.harvestSwapBps = 0;
  p.fees.protocolFeeBps = 1000;
  p.improvements.desk = true;
  p.improvements.deskMode = "direct";
  p.improvements.deskSpreadBps = 10;
  p.improvements.matching = true;
  p.policy.harvestThresholdBps = 500;
  p.policy.cooldownHours = 0;
  p.flows.sizeMedianUsd = 10;
  p.flows.sizeSigma = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].capOn = false;
    p.vaults[k].outflowRate = 1;
    p.vaults[k].inflowUsd = 1000000;
  }
  const contract = runPath(p, 0).summary;
  p.fees.feeBase = "gross";
  const gross = runPath(p, 0).summary;
  expect(gross.entryCost).toBeGreaterThan(0);
  expect(gross.unwindCost).toBeCloseTo(0, 8);
  expect(gross.userEarnedUsd).toBe(0);
  expect(gross.collateralFee).toBeGreaterThan(contract.collateralFee + 0.01);
});

it("interest on stalled exit debt is included in protocol revenue", () => {
  const p = clone(LARK4);
  p.sim.initial = "lark4";
  p.sim.horizonDays = 90;
  p.market.primeYield = 0;
  p.market.hollarRate = 0.1;
  p.fees.discountMain = 0;
  p.fees.discountLoop = 1;
  p.fees.protocolFeeBps = 0;
  p.loop.laneCapBps = 1;
  p.pool.hollar = p.pool.prime * p.market.primePrice;
  p.policy.cooldownHours = 0;
  p.flows.sizeMedianUsd = 1000;
  p.flows.sizeSigma = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].outflowRate = 3;
  }
  const r = runPath(p, 0).summary;
  const years = p.sim.horizonDays / 365;
  const debt = p.vaults.eth.mainDebt + p.vaults.btc.mainDebt;
  const expected = debt * Math.expm1(p.market.hollarRate * years) / years;
  expect(r.withdrawnUsd).toBe(0);
  expect(r.unwindVolume).toBe(0);
  expect(r.entryVolume).toBe(0);
  expect(r.hollarInterest).toBeCloseTo(expected, 6);
});
