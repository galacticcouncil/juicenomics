import { expect, it } from 'vitest';
import { LARK4, clone } from '../src/engine/params/defaults';
import { runPath } from '../src/engine/sim/mc';

const ramp = () => {
  const p = clone(LARK4);
  p.sim.initial = 'fresh';
  p.sim.horizonDays = 1;
  p.vaults.btc.vol = 0;
  p.vaults.btc.units *= 20;
  p.vaults.btc.capOn = false;
  p.arb.inventoryPrime = 50_000_000;
  p.loop.budgetRefillPerSec = 1000;
  p.loop.budgetCap = 1e7;
  return p;
};
it('observed entry throughput caps the ramp at each supported time step', () => {
  for (const step of [0.25, 1, 7, 24]) {
    const p = ramp();
    p.sim.stepHours = step;
    const uncapped = runPath(p, 0).summary.entryVolume / 365;
    p.loop.entryRateOn = true;
    p.loop.entryRatePerHour = 1250;
    const capped = runPath(p, 0).summary.entryVolume / 365;
    expect(capped).toBeGreaterThan(25_000);
    expect(capped).toBeLessThanOrEqual(24 * 1250 * (1 + 1e-9));
    expect(uncapped).toBeGreaterThan(capped * 2);
  }
});
it('disabling the cap preserves the existing simulation', () => {
  const p = ramp();
  const before = runPath(p, 0);
  p.loop.entryRatePerHour = 0;
  expect(runPath(p, 0)).toEqual(before);
  p.loop.entryRateOn = true;
  expect(runPath(p, 0).summary.entryVolume).toBe(0);
});
it('the observed cap cannot bypass lane pacing', () => {
  const p = ramp();
  p.loop.entryRateOn = true;
  p.loop.entryRatePerHour = 10_000_000;
  p.loop.paceSec = 3600;
  expect(runPath(p, 0).summary.entryVolume / 365).toBeLessThanOrEqual(24 * p.loop.tranche * (1 + 1e-9));
});
it('zero entry throughput still allows withdrawals to unwind', () => {
  const p = ramp();
  p.sim.initial = 'ramped';
  p.sim.horizonDays = 30;
  p.vaults.btc.units /= 20;
  p.vaults.btc.outflowRate = 3;
  p.policy.cooldownHours = 0;
  p.policy.headroomOn = false;
  p.loop.entryRateOn = true;
  p.loop.entryRatePerHour = 0;
  const s = runPath(p, 0).summary;
  expect(s.entryVolume).toBe(0);
  expect(s.exitsUsd).toBeGreaterThan(0);
  expect(s.unwindVolume).toBeGreaterThan(0);
});
