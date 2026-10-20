import { expect, it } from "vitest";
import { LARK4, clone } from "../src/engine/params/defaults";
import { runPath } from "../src/engine/sim/mc";
import { evaluate } from "../src/engine/model/closedForm";

it("matched withdrawals settle even when entry execution leaves no PRIME position", () => {
  const p = clone(LARK4);
  p.sim.initial = "fresh";
  p.sim.horizonDays = 30;
  p.loop.mode = "lev";
  p.loop.leverage = 1;
  p.loop.laneCapBps = 1;
  p.market.primeYield = 0;
  p.market.hollarRate = 0;
  p.fees.protocolFeeBps = 0;
  p.policy.cooldownHours = 0;
  p.improvements.matching = true;
  p.flows.sizeMedianUsd = 1000;
  p.flows.sizeSigma = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].outflowRate = 1;
  }
  const r = runPath(p, 0).summary;
  expect(r.entryVolume).toBe(0);
  expect(r.withdrawnUsd).toBeGreaterThan(0);
});

it("pool fee volume does not exceed both legs of every unmatched trade", () => {
  const p = clone(LARK4);
  for (const k of ["eth", "btc"] as const) p.vaults[k].units *= 50;
  const r = evaluate(p);
  const volume = Object.values(r.vaults).reduce((a, v) => a + v.usd.entryVolume + v.usd.unwindVolume, 0);
  const maxFees = 2 * volume * p.pool.feeBps / 1e4;
  expect(r.protocol.lpFees).toBeLessThanOrEqual(maxFees * (1 + 1e-12));
});

it("gross fees include trading costs when there is no main interest", () => {
  const p = clone(LARK4);
  p.sim.initial = "fresh";
  p.sim.horizonDays = 90;
  p.loop.mode = "lev";
  p.loop.leverage = 1;
  p.loop.solverBps = 0;
  p.market.hollarRate = 0;
  p.fees.protocolFeeBps = 1000;
  p.improvements.desk = true;
  p.improvements.deskMode = "direct";
  p.improvements.deskSpreadBps = 10;
  p.policy.costReserveBps = 0;
  for (const k of ["eth", "btc"] as const) p.vaults[k].vol = 0;
  const contract = runPath(p, 0).summary;
  p.fees.feeBase = "gross";
  const gross = runPath(p, 0).summary;
  expect(gross.entryCost).toBeGreaterThan(0);
  expect(gross.collateralFee).toBeGreaterThan(contract.collateralFee);
});

it("yield fees deduct Main interest on withdrawal as well as on harvest", () => {
  const p = clone(LARK4);
  p.sim.initial = "fresh";
  p.sim.horizonDays = 90;
  p.loop.mode = "lev";
  p.loop.leverage = 1;
  p.loop.solverBps = 0;
  p.costs.harvestSwapBps = 0;
  p.fees.protocolFeeBps = 9000;
  p.improvements.desk = true;
  p.improvements.deskMode = "direct";
  p.improvements.deskSpreadBps = 0;
  p.policy.harvestThresholdBps = 500;
  p.policy.cooldownHours = 0;
  p.flows.sizeMedianUsd = 1000;
  p.flows.sizeSigma = 0;
  for (const k of ["eth", "btc"] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].outflowRate = 1;
  }
  const contract = runPath(p, 0).summary;
  p.fees.feeBase = "yield";
  const net = runPath(p, 0).summary;
  expect(net.collateralFee).toBeGreaterThan(0);
  expect(net.collateralFee).toBeLessThan(contract.collateralFee);
});
