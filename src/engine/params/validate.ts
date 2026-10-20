import { PARAMS, getPath, setPath } from "./schema";
import type { Params, VaultKey } from "./types";

export interface Validated {
  params: Params;
  clamped: string[];
  issues: string[];
}

/** clamp every number into its range and report cross-field problems */
export function validate(input: Params): Validated {
  let p = input;
  const clamped: string[] = [];
  for (const d of PARAMS) {
    if (d.kind !== "number") continue;
    const v = getPath(p, d.path) as number;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v));
    if (c !== v) {
      p = setPath(p, d.path, c);
      clamped.push(d.label);
    }
  }
  const issues: string[] = [];
  for (const k of ["eth", "btc"] as VaultKey[]) {
    const v = p.vaults[k];
    if (!(v.bandLo < v.bandTarget && v.bandTarget < v.bandHi)) issues.push(`${v.name}: bands must satisfy relever < target < delever`);
    if (v.bandHi >= v.lt) issues.push(`${v.name}: delever level must stay below the ${(v.lt * 100).toFixed(0)}% liquidation threshold`);
  }
  if (p.loop.mode === "hf" && p.loop.targetHf + p.loop.hfLag <= p.loop.primeLt) issues.push("target HF must exceed the PRIME liquidation threshold");
  if (p.loop.mode === "hf" && p.loop.targetHf < 1) issues.push("a target HF below 1.0 is liquidatable");
  if (p.policy.resumeBps > p.policy.stopBps) issues.push("keeper resume level must not exceed the stop level");
  if (p.loop.tranche > p.loop.budgetCap) issues.push("entry tranche exceeds the entry budget");
  return { params: p, clamped, issues };
}
