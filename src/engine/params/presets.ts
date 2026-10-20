import { LARK4, clone } from "./defaults";
import type { Params } from "./types";

export interface Preset {
  key: string;
  label: string;
  note: string;
  apply: (p: Params) => void;
}

const bands = (p: Params, lo: number, t: number, hi: number) => {
  for (const k of ["eth", "btc"] as const) Object.assign(p.vaults[k], { bandLo: lo, bandTarget: t, bandHi: hi });
};

export const PRESETS: Preset[] = [
  { key: "lark4", label: "Lark 4 today", note: "live configuration, arb at mainnet's 15 / 4 bps", apply: () => {} },
  { key: "realistic", label: "Realistic arb", note: "arbs price in their HOLLAR exit + bridging (~19 bps)", apply: (p) => { p.arb.mode = "realistic"; } },
  { key: "fee2", label: "Pool fee 2 bps", note: "halve pool 143's fee", apply: (p) => { p.pool.feeBps = 2; } },
  { key: "desk", label: "Treasury desk", note: "treasury holds pool 143 at the oracle with its aPRIME", apply: (p) => { p.improvements.desk = true; } },
  { key: "wide", label: "Wide bands 65/75/83", note: "relever only after a bigger rise", apply: (p) => bands(p, 0.65, 0.75, 0.83) },
  { key: "deskWide", label: "Desk + wide bands", note: "both", apply: (p) => { p.improvements.desk = true; bands(p, 0.65, 0.75, 0.83); } },
  { key: "disc50", label: "50% discount + 61% fee", note: "half the HOLLAR interest moves into the collateral fee", apply: (p) => { p.fees.discountMain = 0.5; p.fees.discountLoop = 0.5; p.fees.protocolFeeBps = 6100; } },
  { key: "disc100", label: "Full discount + 75.5% fee", note: "protocol revenue entirely in the collateral", apply: (p) => { p.fees.discountMain = 1; p.fees.discountLoop = 1; p.fees.protocolFeeBps = 7550; } },
  { key: "incentive", label: "+1% PRIME APY (targeted)", note: "extra supply APY on Juicer's aPRIME", apply: (p) => { p.improvements.incentiveBps = 100; } },
  { key: "own", label: "Own-cost attribution", note: "deposits pay their own entry, exits their own unwind (contract change)", apply: (p) => { p.improvements.attribution = "own"; } },
  { key: "entryFee", label: "Pooled + auto entry fee", note: "newcomers pay ~c·L·ℓ into the loop, compensating incumbents for their entry (no contract change to the loop)", apply: (p) => { p.depositFee.on = true; p.depositFee.auto = true; } },
  { key: "lev3", label: "3× leverage", note: "half the leverage", apply: (p) => { p.loop.mode = "lev"; p.loop.leverage = 3; } },
  { key: "mainnet", label: "Mainnet launch", note: "12 h cooldown, caps off, 10× TVL growth, 30%/yr withdrawals", apply: (p) => {
    p.policy.cooldownHours = 12; p.flows.growth = "exp"; p.flows.growthFactor = 10;
    for (const k of ["eth", "btc"] as const) { p.vaults[k].capOn = false; p.vaults[k].outflowRate = 0.3; }
  } },
  { key: "stress", label: "Stress: crash + negative carry", note: "−30% in 48 h and PRIME yield below the HOLLAR rate", apply: (p) => { p.market.stress = "crash30"; p.market.primeYield = 0.04; } },
  { key: "best", label: "Best known", note: "desk, wide bands, full discount + fee, own-cost", apply: (p) => {
    p.improvements.desk = true; bands(p, 0.65, 0.75, 0.83);
    p.fees.discountMain = 1; p.fees.discountLoop = 1; p.fees.protocolFeeBps = 7550;
    p.improvements.attribution = "own";
  } },
];

export function preset(key: string): Params {
  const p = clone(LARK4);
  PRESETS.find((x) => x.key === key)?.apply(p);
  return p;
}
