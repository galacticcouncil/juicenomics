import { expect, it } from 'vitest';
import { LARK4, clone } from '../src/engine/params/defaults';
import { evaluate } from '../src/engine/model/closedForm';
import { runPath } from '../src/engine/sim/mc';

function quiet() {
  const p = clone(LARK4);
  p.sim.horizonDays = 90;
  p.sim.stepHours = 24;
  p.market.monitorMinutes = 1440;
  p.loop.mode = 'lev';
  p.loop.leverage = 1;
  p.loop.solverBps = 0;
  p.market.hollarRate = 0;
  p.market.primeYield = 0;
  p.costs.harvestSwapBps = 0;
  p.fees.protocolFeeBps = 0;
  p.improvements.desk = true;
  p.improvements.deskMode = 'direct';
  p.improvements.deskSpreadBps = 0;
  p.flows.sizeMedianUsd = 10;
  p.flows.sizeSigma = 0;
  for (const k of ['eth', 'btc'] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].capOn = false;
  }
  return p;
}

it('gross exit fees are zero when the loop has earned no yield', () => {
  const p = quiet();
  p.fees.protocolFeeBps = 1000;
  p.fees.feeBase = 'gross';
  p.improvements.deskSpreadBps = 10;
  p.improvements.matching = true;
  p.policy.harvestThresholdBps = 500;
  p.policy.cooldownHours = 0;
  for (const k of ['eth', 'btc'] as const) {
    p.vaults[k].outflowRate = 1;
    p.vaults[k].inflowUsd = 1000000;
  }
  const r = runPath(p, 0).summary;
  expect(r.primeYieldUsd).toBe(0);
  expect(r.entryCost).toBeGreaterThan(0);
  expect(r.unwindCost).toBeCloseTo(0, 8);
  expect(r.userEarnedUsd).toBe(0);
  expect(r.withdrawnUsd).toBeGreaterThan(0);
  expect(r.collateralFee).toBeCloseTo(0, 8);
});

it('loop-bound ETH deposit fees also benefit existing BTC loop shares', () => {
  const p = quiet();
  p.sim.initial = 'ramped';
  p.depositFee.on = true;
  p.depositFee.bps = 100;
  p.depositFee.dest = 'loop';
  p.vaults.eth.inflowUsd = 100000;
  const cf = evaluate(p);
  const mc = runPath(p, 0).summary;
  expect(mc.primeYieldUsd).toBe(0);
  expect(mc.entryCost).toBeCloseTo(0, 8);
  expect(mc.aprBtc).toBeGreaterThan(0.007);
  expect(cf.vaults.eth.usd.depositFeeIn + cf.vaults.btc.usd.depositFeeIn).toBeCloseTo(1000, 6);
  expect(cf.vaults.btc.usd.depositFeeIn).toBeGreaterThan(0);
  expect(cf.vaults.btc.net).toBeGreaterThan(0);
});
