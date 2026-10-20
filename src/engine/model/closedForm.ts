import type { Params, VaultKey } from "../params/types";
import { bands, type BandResult } from "./bands";
import { costs, type CostBreakdown } from "./costs";

export interface Leverage {
  L: number;
  hfEff: number;
  targetHf: number;
  liqDrop: number;
  valid: boolean;
}

export function leverage(p: Params): Leverage {
  const lt = p.loop.primeLt;
  if (p.loop.mode === "lev") {
    const L = Math.max(1, p.loop.leverage);
    const hfEff = L <= 1 ? Infinity : lt / (1 - 1 / L);
    return { L, hfEff, targetHf: hfEff - p.loop.hfLag, liqDrop: hfEff === Infinity ? 1 : 1 - 1 / hfEff, valid: hfEff > 1 };
  }
  const hfEff = p.loop.targetHf + p.loop.hfLag;
  const valid = hfEff > lt;
  const L = valid ? 1 / (1 - lt / hfEff) : Infinity;
  return { L, hfEff, targetHf: p.loop.targetHf, liqDrop: 1 - 1 / hfEff, valid: valid && hfEff > 1 };
}

export interface Step {
  label: string;
  value: number;
  kind: "start" | "add" | "sub" | "total";
}

export interface VaultResult {
  key: VaultKey;
  name: string;
  tvlUsd: number;
  bands: BandResult;
  avgLtv: number;
  /** all per $1 of collateral per year */
  primeYield: number;
  loopInterest: number;
  mainInterest: number;
  gross: number;
  churn: number;
  flows: number;
  feeTaken: number;
  net: number;
  netApy: number;
  inKind: number;
  netWithInKind: number;
  /** one-offs, per $1 of a deposit */
  entryOneOff: number;
  exitOneOff: number;
  depositFee: number;
  year1: number;
  firstCohortGrowthCost: number;
  /** structural deficit of a fully deployed vault, bps of its HOLLAR principal */
  deficitBps: number;
  waterfall: Step[];
  /** usd per year */
  usd: { userNet: number; hollarInterest: number; collateralFee: number; churnCost: number; flowCost: number; primeYield: number; entryVolume: number; unwindVolume: number };
}

export interface ClosedResult {
  lev: Leverage;
  rates: { y: number; rMain: number; rLoop: number; spread: number };
  costs: CostBreakdown;
  vaults: Record<VaultKey, VaultResult>;
  breakEven: { entryDays: number; roundTripDays: number };
  deficit: { structuralBps: number; admissionHeadroomBps: number; depositsClose: boolean; closeAtLeverage: number; stopsAt: number };
  lark4Now: { holeUsd: number; holeBps: number; holeMarketUsd: number };
  protocol: { hollarInterest: number; collateralFee: number; lpFees: number; depositFees: number; deskSpread: number; incentiveCost: number; total: number; inCollateralShare: number };
  external: { arbGross: number; arbOtherLeg: number; arbNet: number; solver: number };
  totals: { tvlUsd: number; userNet: number; userAprWeighted: number; primeYieldPie: number; primeDemandUsd: number };
  issues: string[];
}

const KEYS: VaultKey[] = ["eth", "btc"];

export function evaluate(p: Params): ClosedResult {
  const issues: string[] = [];
  const lev = leverage(p);
  if (!lev.valid) issues.push("target HF must exceed the PRIME liquidation threshold and 1.0");
  const L = Number.isFinite(lev.L) ? lev.L : 1;
  const inc = p.improvements.incentiveBps / 1e4;
  const y = p.market.primeYield + inc;
  const rMain = p.market.hollarRate * (1 - p.fees.discountMain);
  const rLoop = p.market.hollarRate * (1 - p.fees.discountLoop);
  // per $1 of HOLLAR principal
  const spread = L * y - (L - 1) * rLoop - rMain;
  const fee = p.fees.protocolFeeBps / 1e4;
  const monitorYears = p.market.monitorMinutes / (60 * 24 * 365);
  const horizonYears = p.sim.horizonDays / 365;

  // PRIME the loop must buy: churn relevers plus inflows over the horizon
  const tvl = (k: VaultKey) => p.vaults[k].units * p.vaults[k].price;
  const bandOf = (k: VaultKey) => {
    const v = p.vaults[k];
    return bands({ lo: v.bandLo, target: v.bandTarget, hi: v.bandHi, vol: v.vol, drift: v.drift, monitorYears });
  };
  const bandRes = { eth: bandOf("eth"), btc: bandOf("btc") };
  const growthInflow = (k: VaultKey) => (p.flows.growth === "none" ? 0 : tvl(k) * Math.max(0, p.flows.growthFactor - 1) / horizonYears);
  const inflow = (k: VaultKey) => p.vaults[k].inflowUsd + growthInflow(k);
  const primeDemandUsd = KEYS.reduce(
    (acc, k) => acc + L * (bandRes[k].releverPerYear * tvl(k) + inflow(k) * p.vaults[k].bandTarget) * horizonYears,
    p.sim.initial === "fresh" ? KEYS.reduce((a, k) => a + L * tvl(k) * p.vaults[k].bandTarget, 0) : 0,
  );
  const c = costs(p, primeDemandUsd);
  if (c.stall) issues.push(`entry cost ${c.entryBps.toFixed(1)} bps exceeds the ${p.loop.laneCapBps} bps lane cap: entries stall`);
  const cE = c.entryBps / 1e4;
  const cU = c.unwindBps / 1e4;

  // trading volumes per vault, $ per year
  const vol = {} as Record<VaultKey, { entry: number; unwind: number; churnEntry: number; churnUnwind: number }>;
  for (const k of KEYS) {
    const t = tvl(k);
    const br = bandRes[k];
    const v = p.vaults[k];
    const inflowFrac = t > 0 ? inflow(k) / t : 0;
    const churnEntry = L * br.releverPerYear * t;
    const churnUnwind = L * br.deleverPerYear * t;
    vol[k] = {
      churnEntry,
      churnUnwind,
      entry: churnEntry + L * inflowFrac * t * v.bandTarget,
      unwind: churnUnwind + L * v.outflowRate * t * v.bandTarget,
    };
  }
  // buys and sells that meet in pool 143 only pay the round trip; the excess pays the arb's band
  const rt = c.roundTripBps / 1e4;
  const tradingCost = (entry: number, unwind: number) => {
    if (p.costs.churnModel === "constant") return entry * cE + unwind * cU;
    const matched = Math.min(entry, unwind);
    return matched * rt + (entry - matched) * cE + (unwind - matched) * cU;
  };
  const pooled = p.improvements.attribution === "pooled";
  const totalEntry = KEYS.reduce((a, k) => a + vol[k].entry, 0);
  const totalUnwind = KEYS.reduce((a, k) => a + vol[k].unwind, 0);
  const poolCost = tradingCost(totalEntry, totalUnwind);
  const weight = (k: VaultKey) => {
    const w = (x: VaultKey) => bandRes[x].avgLtv * tvl(x);
    const sum = w("eth") + w("btc");
    return sum > 0 ? w(k) / sum : 0.5;
  };

  let lpVolume = 0;
  let deskVolume = 0;
  const vaults = {} as Record<VaultKey, VaultResult>;
  for (const k of KEYS) {
    const v = p.vaults[k];
    const t = tvl(k);
    const br = bandRes[k];
    const lbar = br.avgLtv;
    const primeYield = lbar * L * y;
    const loopInterest = lbar * (L - 1) * rLoop;
    const mainInterest = lbar * rMain;
    const gross = primeYield - loopInterest - mainInterest;
    const inflowFrac = t > 0 ? inflow(k) / t : 0;
    let depositFeeRate = 0;
    if (p.depositFee.on) depositFeeRate = p.depositFee.auto ? cE * L * v.bandTarget : p.depositFee.bps / 1e4;
    // pooled: everyone shares the whole loop's trading; own: a vault pays its own churn, newcomers and leavers their own trades
    const ownChurnUsd = tradingCost(vol[k].churnEntry, vol[k].churnUnwind);
    const pooledUsd = poolCost * weight(k);
    const churnShare = poolCost > 0 ? tradingCost(KEYS.reduce((a, x) => a + vol[x].churnEntry, 0), KEYS.reduce((a, x) => a + vol[x].churnUnwind, 0)) / poolCost : 0;
    const churnUsd = pooled ? pooledUsd * churnShare : ownChurnUsd;
    let flowUsd = pooled ? pooledUsd * (1 - churnShare) : 0;
    // a deposit fee paid into the loop compensates incumbents for newcomers' entries
    if (pooled && p.depositFee.on && p.depositFee.dest === "loop") flowUsd = Math.max(0, flowUsd - inflowFrac * t * depositFeeRate);
    const churn = t > 0 ? churnUsd / t : 0;
    const flows = t > 0 ? flowUsd / t : 0;
    const afterCosts = gross - churn - flows;
    // contracts take the fee on the whole harvest, which still includes the slice that services vault interest
    const feeBase = p.fees.feeBase === "gross" ? gross : p.fees.feeBase === "yield" ? afterCosts : afterCosts + mainInterest;
    const feeTaken = fee * Math.max(0, feeBase);
    const net = afterCosts - feeTaken;
    const entryOneOff = cE * L * v.bandTarget;
    const exitOneOff = cU * L * v.bandTarget;
    const growth = p.flows.growth === "none" ? 1 : p.flows.growthFactor;
    vaults[k] = {
      key: k,
      name: v.name,
      tvlUsd: t,
      bands: br,
      avgLtv: lbar,
      primeYield,
      loopInterest,
      mainInterest,
      gross,
      churn,
      flows,
      feeTaken,
      net,
      netApy: Math.expm1(net),
      inKind: v.inKindYield,
      netWithInKind: net + v.inKindYield,
      entryOneOff,
      exitOneOff,
      depositFee: depositFeeRate,
      year1: net - entryOneOff - exitOneOff - depositFeeRate,
      firstCohortGrowthCost: pooled ? entryOneOff * Math.log(Math.max(1, growth)) : 0,
      deficitBps: cE * L * 1e4,
      waterfall: [
        { label: "PRIME yield", value: primeYield, kind: "start" },
        { label: "loop HOLLAR interest", value: -loopInterest, kind: "sub" },
        { label: "vault HOLLAR interest", value: -mainInterest, kind: "sub" },
        { label: "rebalance churn", value: -churn, kind: "sub" },
        { label: "others' entries & exits", value: -flows, kind: "sub" },
        { label: "protocol fee", value: -feeTaken, kind: "sub" },
        { label: "net to depositors", value: net, kind: "total" },
      ],
      usd: {
        userNet: net * t,
        hollarInterest: (loopInterest + mainInterest) * t,
        collateralFee: feeTaken * t,
        churnCost: churn * t,
        flowCost: flows * t,
        primeYield: primeYield * t,
        entryVolume: vol[k].entry,
        unwindVolume: vol[k].unwind,
      },
    };
    lpVolume += vaults[k].usd.entryVolume + vaults[k].usd.unwindVolume;
    deskVolume += c.deskCoverage * (vaults[k].usd.entryVolume + (p.improvements.deskBid ? vaults[k].usd.unwindVolume : 0));
  }

  const entryDays = spread > 0 ? (365 * cE * L) / spread : Infinity;
  const roundTripDays = spread > 0 ? (365 * (cE + cU) * L) / spread : Infinity;
  const structuralBps = cE * L * 1e4;
  const gate = Math.min(p.policy.admissionBps, p.policy.stopBps);
  if (structuralBps > gate) issues.push(`a fully ramped loop runs ~${structuralBps.toFixed(0)} bps short, past the ${gate} bps deposit gate`);

  const tvlTotal = KEYS.reduce((a, k) => a + vaults[k].tvlUsd, 0);
  const hollarInterest = KEYS.reduce((a, k) => a + vaults[k].usd.hollarInterest, 0);
  const collateralFee = KEYS.reduce((a, k) => a + vaults[k].usd.collateralFee, 0);
  // both the loop's trade and the arb's (or desk's) answering trade pay the pool fee
  const feeRate = p.pool.feeBps / 1e4;
  const arbVolume = (1 - c.deskCoverage) * KEYS.reduce((a, k) => a + vaults[k].usd.entryVolume, 0);
  const lpFees = feeRate * (2 * lpVolume);
  const depositFees = p.depositFee.on && p.depositFee.dest === "protocol"
    ? KEYS.reduce((a, k) => a + vaults[k].depositFee * inflow(k), 0)
    : 0;
  const deskSpread = (p.improvements.deskSpreadBps / 1e4) * deskVolume;
  const juicerPrime = KEYS.reduce((a, k) => a + vaults[k].avgLtv * L * vaults[k].tvlUsd, 0);
  const incentiveCost = p.improvements.incentiveScope === "blanket"
    ? inc * Math.max(juicerPrime, p.improvements.blanketPrime * p.market.primePrice)
    : inc * juicerPrime;
  const total = hollarInterest + collateralFee + lpFees + depositFees + deskSpread - incentiveCost;
  const arbGross = (c.bandBps / 1e4) * arbVolume;
  const arbOtherLeg = (c.arbOtherLegBps / 1e4) * arbVolume;
  const userNet = KEYS.reduce((a, k) => a + vaults[k].usd.userNet, 0);
  const holeUsd = p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal - (p.loop.collateralUsd - p.loop.debtUsd);
  const principal = p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal;
  const hollarShort = p.loop.debtUsd + p.vaults.eth.mainDebt + p.vaults.btc.mainDebt;

  return {
    lev,
    rates: { y, rMain, rLoop, spread },
    costs: c,
    vaults,
    breakEven: { entryDays, roundTripDays },
    deficit: {
      structuralBps,
      admissionHeadroomBps: p.policy.admissionBps - structuralBps,
      depositsClose: structuralBps > gate,
      closeAtLeverage: cE > 0 ? gate / (cE * 1e4) : Infinity,
      stopsAt: gate,
    },
    lark4Now: {
      holeUsd,
      holeBps: principal > 0 ? (holeUsd / principal) * 1e4 : 0,
      holeMarketUsd: holeUsd - (1 - p.market.hollarMark) * hollarShort,
    },
    protocol: { hollarInterest, collateralFee, lpFees, depositFees, deskSpread, incentiveCost, total, inCollateralShare: total > 0 ? collateralFee / total : 0 },
    external: { arbGross, arbOtherLeg, arbNet: arbGross - arbOtherLeg, solver: (p.loop.solverBps / 1e4) * KEYS.reduce((a, k) => a + vaults[k].usd.entryVolume, 0) },
    totals: {
      tvlUsd: tvlTotal,
      userNet,
      userAprWeighted: tvlTotal > 0 ? userNet / tvlTotal : 0,
      primeYieldPie: KEYS.reduce((a, k) => a + vaults[k].usd.primeYield, 0),
      primeDemandUsd,
    },
    issues,
  };
}
