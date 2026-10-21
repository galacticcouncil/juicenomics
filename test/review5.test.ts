import { expect, it } from 'vitest';
import { LARK4, clone } from '../src/engine/params/defaults';
import { runPath } from '../src/engine/sim/mc';

it('deleveraging cannot charge a 10% gross fee on more than all earned PRIME yield', () => {
  const p = clone(LARK4);
  p.sim.horizonDays = 365;
  p.sim.stepHours = 24;
  p.market.monitorMinutes = 1440;
  p.loop.mode = 'lev';
  p.loop.leverage = 1;
  p.loop.solverBps = 0;
  p.market.hollarRate = 0;
  p.market.primeYield = 0.06;
  p.market.stress = 'crash30';
  p.market.stressDay = 90;
  p.costs.harvestSwapBps = 0;
  p.fees.protocolFeeBps = 1000;
  p.fees.feeBase = 'gross';
  p.improvements.desk = true;
  p.improvements.deskMode = 'direct';
  p.improvements.deskSpreadBps = 10;
  p.policy.costReserveBps = 0;
  p.policy.harvestThresholdBps = 2;
  for (const k of ['eth', 'btc'] as const) {
    p.vaults[k].vol = 0;
    p.vaults[k].capOn = false;
  }
  const s = runPath(p, 0).summary;
  expect(s.deleversEth + s.deleversBtc).toBeGreaterThan(0);
  expect(s.hollarInterest + s.depositFees + s.incentiveCost).toBe(0);
  expect(s.entryCost).toBeGreaterThan(0);
  expect(s.unwindCost).toBeGreaterThan(0);
  expect(s.stallHours + s.unwindStallHours).toBe(0);
  expect(Math.abs(s.conservationGapUsd)).toBeLessThan(1e-7);
  expect(s.collateralFee).toBeLessThanOrEqual(s.primeYieldUsd * 0.1 + 0.01);
});
