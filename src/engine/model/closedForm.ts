import type { Params, VaultKey } from "../params/types";
import { bands, type BandResult } from "./bands";
import { costs, type CostBreakdown } from "./costs";

/** how much of the pool-aware churn saving survives as rebalances grow against pool 143; below 0 once they
 * outgrow the pool and the arb's inventory and cost more than a tranche at the arb's band (fitted 20 Oct to the
 * Monte Carlo at 1-50× Lark 4's TVL, wide bands and a 2 bps pool fee: rmse 0.10 pp) */
export const NETTING = { floor: -0.3, base: 1.5, div: 32 };

export interface TvlPath {
  /** average and final TVL over the horizon, $ */
  avgUsd: number;
  endUsd: number;
  /** deposits actually admitted, $ per year */
  inflowPerYear: number;
  /** time average of inflow / TVL: what an incumbent's share of newcomers' entries scales with */
  holderInflow: number;
}

/** each vault's TVL over the horizon at today's prices: steady inflows, growth, withdrawals and the cap, as the Monte Carlo admits them */
export function tvlPaths(p: Params, years: number): { vaults: Record<VaultKey, TvlPath>; holderInflow: number; avgUsd: number; inflowPerYear: number } {
  const T = Math.max(1 / 365, years);
  const n = 400;
  const h = T / n;
  const lambda = p.flows.growth === "exp" ? Math.log(Math.max(1, p.flows.growthFactor)) / T : 0;
  const keys: VaultKey[] = ["eth", "btc"];
  const V = {} as Record<VaultKey, number>;
  const sum = {} as Record<VaultKey, { v: number; inflow: number; frac: number }>;
  for (const k of keys) {
    V[k] = p.vaults[k].units * p.vaults[k].price;
    sum[k] = { v: 0, inflow: 0, frac: 0 };
  }
  let loopFrac = 0;
  for (let i = 0; i < n; i++) {
    let inAll = 0;
    let vAll = 0;
    for (const k of keys) {
      const v = p.vaults[k];
      const linear = p.flows.growth === "linear" ? (v.units * v.price * Math.max(0, p.flows.growthFactor - 1)) / T : 0;
      const out = v.outflowRate * V[k];
      const cap = v.capOn ? v.tvlCap * v.price : Infinity;
      const inflow = Math.min(v.inflowUsd + linear + lambda * V[k], Math.max(0, (cap - V[k]) / h + out));
      sum[k].v += V[k];
      sum[k].inflow += inflow;
      sum[k].frac += V[k] > 0 ? inflow / V[k] : 0;
      inAll += inflow;
      vAll += V[k];
      V[k] = Math.max(0, V[k] + (inflow - out) * h);
    }
    loopFrac += vAll > 0 ? inAll / vAll : 0;
  }
  const vaults = {} as Record<VaultKey, TvlPath>;
  for (const k of keys) vaults[k] = { avgUsd: sum[k].v / n, endUsd: V[k], inflowPerYear: sum[k].inflow / n, holderInflow: sum[k].frac / n };
  return {
    vaults,
    holderInflow: loopFrac / n,
    avgUsd: keys.reduce((a, k) => a + vaults[k].avgUsd, 0),
    inflowPerYear: keys.reduce((a, k) => a + vaults[k].inflowPerYear, 0),
  };
}

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
  /** days of the depositor's net carry to earn back its own entry (and exit) */
  breakEvenDays: number;
  roundTripDays: number;
  /** what a day-0 holder earns over the simulated horizon (a fresh start pays its ramp in it): compare with the Monte Carlo */
  horizonApr: number;
  /** average TVL over the horizon, the base for the $ figures */
  avgTvlUsd: number;
  /** structural deficit of a fully deployed vault, bps of its HOLLAR principal */
  deficitBps: number;
  waterfall: Step[];
  /** usd per year */
  usd: { userNet: number; hollarInterest: number; collateralFee: number; churnCost: number; flowCost: number; primeYield: number; entryVolume: number; unwindVolume: number };
}

export interface ClosedResult {
  lev: Leverage;
  rates: { y: number; rMain: number; rLoop: number; spread: number };
  scale: { eventUsd: number; depthUsd: number; netting: number };
  costs: CostBreakdown;
  vaults: Record<VaultKey, VaultResult>;
  /** depositor break-even of the slower vault; holeDays: the vault deficit repaid from pre-fee carry */
  breakEven: { entryDays: number; roundTripDays: number; holeDays: number };
  deficit: { structuralBps: number; admissionHeadroomBps: number; depositsClose: boolean; closeAtLeverage: number; stopsAt: number };
  lark4Now: { holeUsd: number; holeBps: number; holeMarketUsd: number };
  protocol: { hollarInterest: number; collateralFee: number; lpFees: number; depositFees: number; deskSpread: number; incentiveCost: number; total: number; inCollateralShare: number };
  external: { arbGross: number; arbOtherLeg: number; arbNet: number; solver: number };
  /** HOLLAR Juicer borrows (loop + vaults) and pushes through pool 143: per $1 deposited, at steady state, sold at a fresh ramp, and per year */
  hollar: { perDollar: number; debtUsd: number; rampSoldUsd: number; soldPerYear: number; boughtPerYear: number; headroomUsd: number; overHeadroom: boolean; maxTvlUsd: number };
  /** tvlUsd: today; avgTvlUsd / endTvlUsd: over the horizon (growth, withdrawals, caps), the base for $ per year */
  totals: { tvlUsd: number; avgTvlUsd: number; endTvlUsd: number; userNet: number; userAprWeighted: number; primeYieldPie: number; primeDemandUsd: number };
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
  // a growing (or capped) vault: $ volumes and revenue scale with its average TVL over the horizon
  const growthPath = tvlPaths(p, horizonYears);
  const size = (k: VaultKey) => growthPath.vaults[k].avgUsd;
  const bandOf = (k: VaultKey) => {
    const v = p.vaults[k];
    return bands({ lo: v.bandLo, target: v.bandTarget, hi: v.bandHi, vol: v.vol, drift: v.drift, monitorYears });
  };
  const bandRes = { eth: bandOf("eth"), btc: bandOf("btc") };
  const inflow = (k: VaultKey) => growthPath.vaults[k].inflowPerYear;
  const primeDemandUsd = KEYS.reduce(
    (acc, k) => acc + L * (bandRes[k].releverPerYear * size(k) + inflow(k) * p.vaults[k].bandTarget) * horizonYears,
    p.sim.initial === "fresh" ? KEYS.reduce((a, k) => a + L * tvl(k) * p.vaults[k].bandTarget, 0) : 0,
  );
  const c = costs(p, primeDemandUsd);
  if (c.stall) issues.push(`entry cost ${c.entryBps.toFixed(1)} bps exceeds the ${p.loop.laneCapBps} bps lane cap: entries stall`);
  const cE = c.entryBps / 1e4;
  const cU = c.unwindBps / 1e4;

  // trading volumes per vault, $ per year
  const vol = {} as Record<VaultKey, { entry: number; unwind: number; churnEntry: number; churnUnwind: number }>;
  for (const k of KEYS) {
    const t = size(k);
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
  // netting works while one rebalance is small against pool 143; big ones push past the arb's band
  const depthUsd = p.pool.prime * p.market.primePrice + p.pool.hollar;
  const eventUsd = KEYS.reduce((a, k) => {
    const br = bandRes[k];
    const t = size(k);
    const ev = br.eventsPerYear > 0 ? (br.releverPerYear + br.deleverPerYear) / br.eventsPerYear : 0;
    return a + L * ev * t;
  }, 0) / KEYS.length;
  const netting = Math.min(1, NETTING.floor + (NETTING.base - NETTING.floor) / (1 + eventUsd / Math.max(1, depthUsd / NETTING.div)));
  const tradingCost = (entry: number, unwind: number) => {
    const constant = entry * cE + unwind * cU;
    if (p.costs.churnModel === "constant") return constant;
    const matched = Math.min(entry, unwind);
    const pooled = matched * rt + (entry - matched) * cE + (unwind - matched) * cU;
    return netting * pooled + (1 - netting) * constant;
  };
  const arbCapacityUsd = p.arb.inventoryPrime * p.market.primePrice + (p.improvements.desk ? p.improvements.deskPrime * p.market.primePrice : 0);
  if (eventUsd > arbCapacityUsd) issues.push(`a typical rebalance (${Math.round(eventUsd / 1000)}k of PRIME) exceeds the arb's and desk's inventory: expect stalls`);
  const pooled = p.improvements.attribution === "pooled";
  const totalEntry = KEYS.reduce((a, k) => a + vol[k].entry, 0);
  const totalUnwind = KEYS.reduce((a, k) => a + vol[k].unwind, 0);
  const poolCost = tradingCost(totalEntry, totalUnwind);
  const weight = (k: VaultKey) => {
    const w = (x: VaultKey) => bandRes[x].avgLtv * size(x);
    const sum = w("eth") + w("btc");
    return sum > 0 ? w(k) / sum : 0.5;
  };

  // an incumbent bears each newcomer's pooled entry in proportion to the TVL at the time, so constant-$ inflows into a
  // growing vault cost it the time average of inflow/TVL, more than the $ average (1× for exponential growth)
  const inflowProxy = KEYS.reduce((a, k) => a + L * inflow(k) * p.vaults[k].bandTarget * cE, 0);
  const outflowProxy = KEYS.reduce((a, k) => a + L * p.vaults[k].outflowRate * size(k) * p.vaults[k].bandTarget * cU, 0);
  const inflowShare = inflowProxy + outflowProxy > 0 ? inflowProxy / (inflowProxy + outflowProxy) : 0;
  const holderJensen = growthPath.inflowPerYear > 0 ? (growthPath.holderInflow * growthPath.avgUsd) / growthPath.inflowPerYear : 1;
  const holderFlows = inflowShare * holderJensen + (1 - inflowShare);

  let deskVolume = 0;
  const vaults = {} as Record<VaultKey, VaultResult>;
  for (const k of KEYS) {
    const v = p.vaults[k];
    const t = size(k);
    const br = bandRes[k];
    const lbar = br.avgLtv;
    const primeYield = lbar * L * y;
    const loopInterest = lbar * (L - 1) * rLoop;
    const mainInterest = lbar * rMain;
    const gross = primeYield - loopInterest - mainInterest;
    let depositFeeRate = 0;
    if (p.depositFee.on) depositFeeRate = p.depositFee.auto ? cE * L * v.bandTarget : p.depositFee.bps / 1e4;
    // pooled: everyone shares the whole loop's trading; own: a vault pays its own churn, newcomers and leavers their own trades
    const ownChurnUsd = tradingCost(vol[k].churnEntry, vol[k].churnUnwind);
    const pooledUsd = poolCost * weight(k);
    const churnShare = poolCost > 0 ? tradingCost(KEYS.reduce((a, x) => a + vol[x].churnEntry, 0), KEYS.reduce((a, x) => a + vol[x].churnUnwind, 0)) / poolCost : 0;
    const churnUsd = pooled ? pooledUsd * churnShare : ownChurnUsd;
    const flowUsd = pooled ? pooledUsd * (1 - churnShare) : 0;
    const churn = t > 0 ? churnUsd / t : 0;
    // a deposit fee paid into the loop goes to everyone already in it; past newcomers' costs it's a gain
    const feeBack = p.depositFee.on && p.depositFee.dest === "loop" ? growthPath.vaults[k].holderInflow * depositFeeRate : 0;
    const flows = (t > 0 ? (flowUsd / t) * holderFlows : 0) - feeBack;
    const afterCosts = gross - churn - flows;
    // contracts take the fee on the whole harvest, which still includes the slice that services vault interest
    const feeBase = p.fees.feeBase === "gross" ? gross : p.fees.feeBase === "yield" ? afterCosts : afterCosts + mainInterest;
    const feeTaken = fee * Math.max(0, feeBase);
    const net = afterCosts - feeTaken;
    const entryOneOff = cE * L * v.bandTarget;
    const exitOneOff = cU * L * v.bandTarget;
    vaults[k] = {
      key: k,
      name: v.name,
      tvlUsd: tvl(k),
      avgTvlUsd: t,
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
      breakEvenDays: net > 0 ? (365 * (entryOneOff + depositFeeRate)) / net : Infinity,
      roundTripDays: net > 0 ? (365 * (entryOneOff + exitOneOff + depositFeeRate)) / net : Infinity,
      horizonApr: net - (p.sim.initial === "fresh" ? entryOneOff / Math.max(1 / 365, horizonYears) : 0),
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
    deskVolume += c.deskCoverage * (vaults[k].usd.entryVolume + (p.improvements.deskBid ? vaults[k].usd.unwindVolume : 0));
  }

  // nothing is harvested (or fee'd) until the hole is repaid, so it closes on the vault's pre-fee carry
  const holeDays = spread > 0 ? (365 * cE * L) / spread : Infinity;
  const entryDays = Math.max(...KEYS.map((k) => vaults[k].breakEvenDays));
  const roundTripDays = Math.max(...KEYS.map((k) => vaults[k].roundTripDays));
  const structuralBps = cE * L * 1e4;
  const gate = Math.min(p.policy.admissionBps, p.policy.stopBps);
  if (structuralBps > gate) issues.push(`a fully ramped loop runs ~${structuralBps.toFixed(0)} bps short, past the ${gate} bps deposit gate`);

  const tvlTotal = KEYS.reduce((a, k) => a + vaults[k].tvlUsd, 0);
  const hollarInterest = KEYS.reduce((a, k) => a + vaults[k].usd.hollarInterest, 0);
  const collateralFee = KEYS.reduce((a, k) => a + vaults[k].usd.collateralFee, 0);
  // only trades that cross pool 143 pay its fee: direct desk fills don't. an unmatched trade pays twice
  // (the loop's and the arb's or desk's answer), matched buys and sells once each
  const feeRate = p.pool.feeBps / 1e4;
  const direct = p.improvements.desk && p.improvements.deskMode === "direct";
  const poolEntry = (direct ? 1 - c.deskCoverage : 1) * totalEntry;
  const poolUnwind = (direct && p.improvements.deskBid ? 1 - c.deskCoverage : 1) * totalUnwind;
  // the cost curve may extrapolate past [0, 1]; matched token volume can't
  const matched = p.costs.churnModel === "constant" ? 0 : Math.min(1, Math.max(0, netting)) * Math.min(poolEntry, poolUnwind);
  const arbVolume = (direct ? 1 : 1 - c.deskCoverage) * Math.max(0, poolEntry - matched);
  const lpFees = feeRate * (2 * (poolEntry + poolUnwind) - 2 * matched);
  const depositFees = p.depositFee.on && p.depositFee.dest === "protocol"
    ? KEYS.reduce((a, k) => a + vaults[k].depositFee * inflow(k), 0)
    : 0;
  const deskSpread = (p.improvements.deskSpreadBps / 1e4) * deskVolume;
  const juicerPrime = KEYS.reduce((a, k) => a + vaults[k].avgLtv * L * vaults[k].avgTvlUsd, 0);
  const incentiveCost = p.improvements.incentiveScope === "blanket"
    ? inc * Math.max(juicerPrime, p.improvements.blanketPrime * p.market.primePrice)
    : inc * juicerPrime;
  const total = hollarInterest + collateralFee + lpFees + depositFees + deskSpread - incentiveCost;
  const arbGross = (c.bandBps / 1e4) * arbVolume;
  const arbOtherLeg = (c.arbOtherLegBps / 1e4) * arbVolume;
  const userNet = KEYS.reduce((a, k) => a + vaults[k].usd.userNet, 0);
  // every $1 a vault borrows from Main enters the loop, which borrows L − 1 more: all L of it is HOLLAR sold for PRIME
  const hollarDebt = KEYS.reduce((a, k) => a + L * vaults[k].avgLtv * vaults[k].avgTvlUsd, 0);
  const hollarPerDollar = growthPath.avgUsd > 0 ? hollarDebt / growthPath.avgUsd : 0;
  const hollarPeak = Math.max(hollarDebt, KEYS.reduce((a, k) => a + L * p.vaults[k].bandTarget * Math.max(tvl(k), growthPath.vaults[k].endUsd), 0));
  if (hollarPeak > p.market.hollarHeadroomUsd) issues.push(`Juicer would borrow ~$${Math.round(hollarPeak / 1e3)}k of HOLLAR, past the $${Math.round(p.market.hollarHeadroomUsd / 1e3)}k the facilitator can still mint`);
  // equityOf includes HOLLAR still waiting to enter, so the hole doesn't jump while an entry is in flight
  const holeUsd = p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal - Math.max(p.loop.collateralUsd - p.loop.debtUsd, p.vaults.eth.loopEquityUsd + p.vaults.btc.loopEquityUsd);
  const principal = p.vaults.eth.loopPrincipal + p.vaults.btc.loopPrincipal;
  const hollarShort = p.loop.debtUsd + p.vaults.eth.mainDebt + p.vaults.btc.mainDebt;

  return {
    lev,
    rates: { y, rMain, rLoop, spread },
    scale: { eventUsd, depthUsd, netting },
    costs: c,
    vaults,
    breakEven: { entryDays, roundTripDays, holeDays },
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
    hollar: {
      perDollar: hollarPerDollar,
      debtUsd: hollarDebt,
      rampSoldUsd: p.sim.initial === "fresh" ? KEYS.reduce((a, k) => a + L * p.vaults[k].bandTarget * tvl(k), 0) : 0,
      soldPerYear: KEYS.reduce((a, k) => a + vaults[k].usd.entryVolume, 0),
      boughtPerYear: KEYS.reduce((a, k) => a + vaults[k].usd.unwindVolume, 0),
      headroomUsd: p.market.hollarHeadroomUsd,
      overHeadroom: hollarPeak > p.market.hollarHeadroomUsd,
      maxTvlUsd: hollarPerDollar > 0 ? p.market.hollarHeadroomUsd / hollarPerDollar : Infinity,
    },
    external: { arbGross, arbOtherLeg, arbNet: arbGross - arbOtherLeg, solver: (p.loop.solverBps / 1e4) * KEYS.reduce((a, k) => a + vaults[k].usd.entryVolume, 0) },
    totals: {
      tvlUsd: tvlTotal,
      avgTvlUsd: growthPath.avgUsd,
      endTvlUsd: KEYS.reduce((a, k) => a + growthPath.vaults[k].endUsd, 0),
      userNet,
      userAprWeighted: growthPath.avgUsd > 0 ? userNet / growthPath.avgUsd : 0,
      primeYieldPie: KEYS.reduce((a, k) => a + vaults[k].usd.primeYield, 0),
      primeDemandUsd,
    },
    issues,
  };
}
