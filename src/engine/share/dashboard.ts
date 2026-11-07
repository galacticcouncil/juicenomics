import { clone } from '../params/defaults';
import type { Params } from '../params/types';

export interface DashboardHandoff {
  block: number;
  ratePerHour: number;
  windowHours: number;
  observedAt: number;
  modelHf: number;
}

export function dashboardHandoff(hash: Record<string, string>): DashboardHandoff | null {
  if (!Object.hasOwn(hash, 'juicer')) return null;
  if (hash.juicer !== '1' || Object.hasOwn(hash, 's') || Object.hasOwn(hash, 'b')) throw new Error('ambiguous dashboard link');
  const read = (key: string, min: number, max: number, integer = false) => {
    if (!/^\d+(?:\.\d+)?$/.test(hash[key] ?? '')) throw new Error(`invalid dashboard ${key}`);
    const value = Number(hash[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(`invalid dashboard ${key}`);
    return value;
  };
  const block = read('block', 16683448, Number.MAX_SAFE_INTEGER, true);
  const ratePerHour = read('entryRate', 0, 10_000_000);
  const windowHours = read('rateWindow', 1, 24, true);
  if (![1, 4, 24].includes(windowHours)) throw new Error('invalid dashboard rate window');
  return { block, ratePerHour, windowHours, observedAt: read('at', 1793956542, 8.64e12, true), modelHf: read('modelHf', 1, 3) };
}

export function applyDashboardRate(params: Params, handoff: DashboardHandoff): Params {
  if (params.deployment !== 'mainnet' || params.sim.stateBlock !== handoff.block) throw new Error('dashboard block mismatch');
  const lag = handoff.modelHf - params.loop.targetHf;
  if (lag < -1e-9 || lag > 0.05 + 1e-9) throw new Error('dashboard HF is outside the supported lag range');
  const p = clone(params);
  p.loop.entryRateOn = true;
  p.loop.entryRatePerHour = handoff.ratePerHour;
  p.loop.mode = 'hf';
  p.loop.hfLag = Math.max(0, lag);
  p.sim.initial = 'lark4';
  return p;
}
