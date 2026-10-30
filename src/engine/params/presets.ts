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
  { key: "lark4", label: "Lark 4 today", note: "jBTC alone, 65/75/83 band, 69% fee, 40% / 90% discounts, headroom exits, arb at mainnet's 15 / 4 bps", apply: () => {} },
  { key: "jeth", label: "jETH on too", note: "a jETH vault on GIGAETH beside jBTC, with the same band and fees", apply: (p) => { p.vaults.eth.on = true; } },
  { key: "noHeadroom", label: "No headroom exits", note: "every exit unwinds its loop slice, as before the release", apply: (p) => { p.policy.headroomOn = false; } },
  { key: "realistic", label: "Realistic arb", note: "arbs price in their HOLLAR exit + bridging (~19 bps)", apply: (p) => { p.arb.mode = "realistic"; } },
  { key: "fee4", label: "Pool fee 4 bps", note: "mainnet's pool 143 fee instead of the 1 bp launch fee", apply: (p) => { p.pool.feeBps = 4; } },
  { key: "desk", label: "Treasury desk", note: "treasury holds pool 143 at the oracle with its aPRIME", apply: (p) => { p.improvements.desk = true; } },
  { key: "tight", label: "Tight band 75/80/83", note: "the contract's band without per-vault gaps (0 / 500 / 300 bps), as on the 16 Oct Lark 4", apply: (p) => bands(p, 0.75, 0.8, 0.83) },
  { key: "split16", label: "5% fee, no discounts", note: "the 16 Oct revenue split: the protocol earns HOLLAR interest, not collateral", apply: (p) => { p.fees.discountMain = 0; p.fees.discountLoop = 0; p.fees.protocolFeeBps = 500; } },
  { key: "disc100", label: "Full discount + 75.5% fee", note: "protocol revenue entirely in the collateral", apply: (p) => { p.fees.discountMain = 1; p.fees.discountLoop = 1; p.fees.protocolFeeBps = 7550; } },
  { key: "incentive", label: "+1% PRIME APY (targeted)", note: "extra supply APY on Juicer's aPRIME", apply: (p) => { p.improvements.incentiveBps = 100; } },
  { key: "own", label: "Own-cost attribution", note: "deposits pay their own entry, exits their own unwind (contract change)", apply: (p) => { p.improvements.attribution = "own"; } },
  { key: "entryFee", label: "Pooled + auto entry fee", note: "newcomers pay ~c·L·ℓ into the loop, compensating incumbents for their entry (no contract change to the loop)", apply: (p) => { p.depositFee.on = true; p.depositFee.auto = true; } },
  { key: "lev3", label: "3× leverage", note: "half the leverage", apply: (p) => { p.loop.mode = "lev"; p.loop.leverage = 3; } },
  { key: "mainnet", label: "Mainnet launch", note: "jBTC first: 12 h cooldown, caps off, 10× TVL growth, 30%/yr withdrawals", apply: (p) => {
    p.policy.cooldownHours = 12; p.flows.growth = "exp"; p.flows.growthFactor = 10;
    for (const k of ["eth", "btc"] as const) { p.vaults[k].capOn = false; p.vaults[k].outflowRate = 0.3; }
  } },
  { key: "stress", label: "Stress: crash + negative carry", note: "−30% in 48 h and PRIME yield below the HOLLAR rate", apply: (p) => { p.market.stress = "crash30"; p.market.primeYield = 0.04; } },
  { key: "best", label: "Best known", note: "desk, full discount + fee, own-cost", apply: (p) => {
    p.improvements.desk = true;
    p.fees.discountMain = 1; p.fees.discountLoop = 1; p.fees.protocolFeeBps = 7550;
    p.improvements.attribution = "own";
  } },
];

export function preset(key: string): Params {
  const p = clone(LARK4);
  PRESETS.find((x) => x.key === key)?.apply(p);
  return p;
}
