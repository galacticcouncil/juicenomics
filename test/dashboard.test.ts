import { describe, expect, it } from 'vitest';
import { MAINNET, clone } from '../src/engine/params/defaults';
import { PARAMS } from '../src/engine/params/schema';
import { decode, encode } from '../src/engine/share/codec';
import { applyDashboardRate, dashboardHandoff } from '../src/engine/share/dashboard';

const hash = { juicer: '1', block: '16730194', entryRate: '1250.1234', rateWindow: '4', at: '1794057000', modelHf: '1.05525' };
describe('dashboard transfer', () => {
  it('loads the pinned position with the observed rate and buffered target', async () => {
    const handoff = dashboardHandoff(hash)!;
    const p = clone(MAINNET);
    p.sim.stateBlock = handoff.block;
    const imported = applyDashboardRate(p, handoff);
    expect(imported.loop.entryRateOn).toBe(true);
    expect(imported.loop.entryRatePerHour).toBe(1250.1234);
    expect(imported.loop.targetHf + imported.loop.hfLag).toBeCloseTo(1.05525, 9);
    expect(imported.sim.initial).toBe('lark4');
    expect(p.loop.entryRateOn).toBe(false);
    const back = await decode(await encode(imported));
    expect(back.error).toBeUndefined();
    expect(back.clamped).toEqual([]);
    expect(back.params.loop.entryRatePerHour).toBe(imported.loop.entryRatePerHour);
    expect(back.params.loop.entryRateOn).toBe(true);
    expect(back.params.sim.stateBlock).toBe(handoff.block);
    expect(back.params.deployment).toBe('mainnet');
  });
  it('zero means no entries and survives ordinary share links', async () => {
    const handoff = dashboardHandoff({ ...hash, entryRate: '0' })!;
    const p = clone(MAINNET);
    p.sim.stateBlock = handoff.block;
    const back = await decode(await encode(applyDashboardRate(p, handoff)));
    expect(back.params.loop.entryRateOn).toBe(true);
    expect(back.params.loop.entryRatePerHour).toBe(0);
    for (const token of ['', '3je30', '2je30', '1je30']) expect((await decode(token)).params.loop.entryRateOn).toBe(false);
    expect(new Set(PARAMS.map(d => d.code)).size).toBe(PARAMS.length);
  });
  it('rejects malformed and ambiguous links before reading the chain', () => {
    expect(dashboardHandoff({ s: '3je30' })).toBe(null);
    const badLinks: Record<string, string>[] = [{ juicer: '2' }, { s: '3je30' }, { b: '3je30' }, { block: '1' }, { block: '16730194.5' },
      { entryRate: '-1' }, { entryRate: 'Infinity' }, { entryRate: '10000001' }, { entryRate: '' }, { rateWindow: '2' }, { modelHf: '0' }, { at: '0' }];
    for (const bad of badLinks) {
      expect(() => dashboardHandoff({ ...hash, ...bad })).toThrow();
    }
  });
  it('refuses mismatched state or an unsupported HF floor', () => {
    const handoff = dashboardHandoff(hash)!;
    const p = clone(MAINNET);
    expect(() => applyDashboardRate(p, handoff)).toThrow('block mismatch');
    p.sim.stateBlock = handoff.block;
    expect(() => applyDashboardRate({ ...p, deployment: 'lark0' }, handoff)).toThrow('block mismatch');
    expect(() => applyDashboardRate(p, { ...handoff, modelHf: 1.2 })).toThrow('lag range');
  });
});
