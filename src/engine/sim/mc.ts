import { leverage } from "../model/closedForm";
import { costs as closedCosts, arbSellThreshold } from "../model/costs";
import { apply as fastApply, quote as fastQuote, type PoolState } from "../pool/fastPool";
import { fastPool, wasmPool, type Pool, type StableswapWasm } from "../pool/pool";
import type { Params, VaultKey } from "../params/types";
import { makePaths, stressFactor } from "./paths";
import { poisson, rng } from "./rng";

export const SERIES = [
  "priceEth", "priceBtc", "prime", "loopDeficit", "defEth", "defBtc", "ltvEth", "ltvBtc",
  "hf", "lev", "premium", "arbPrime", "navEth", "navBtc", "protocolCum", "costCum", "stopEth", "stopBtc", "tvl",
] as const;
export type SeriesKey = (typeof SERIES)[number];
export const SERIES_INDEX = Object.fromEntries(SERIES.map((k, i) => [k, i])) as Record<SeriesKey, number>;

export interface Cohort {
  vault: VaultKey;
  day: number;
  usd: number;
  units: number;
  shares: number;
  exitedUnits: number;
  exitedShares: number;
}

export interface PathSummary {
  aprEth: number;
  aprBtc: number;
  protocol: number;
  hollarInterest: number;
  collateralFee: number;
  lpFees: number;
  depositFees: number;
  deskPnl: number;
  incentiveCost: number;
  entryCost: number;
  unwindCost: number;
  harvestCost: number;
  solver: number;
  arbGross: number;
  arbOtherLeg: number;
  maxLoopDeficitBps: number;
  endLoopDeficitBps: number;
  stopHoursEth: number;
  stopHoursBtc: number;
  blockedUsd: number;
  depositedUsd: number;
  withdrawnUsd: number;
  stallHours: number;
  unwindStallHours: number;
  arbDryHours: number;
  releversEth: number;
  deleversEth: number;
  releversBtc: number;
  deleversBtc: number;
  minHf: number;
  entryVolume: number;
  unwindVolume: number;
  entryAvgBps: number;
  unwindAvgBps: number;
  userEarnedUsd: number;
  cohorts: { vault: VaultKey; day: number; usd: number; apr: number; heldDays: number }[];
}

export interface PathResult {
  series: Float32Array;
  days: number;
  summary: PathSummary;
}

interface Vault {
  key: VaultKey;
  Q: number;
  D: number;
  mainPrincipal: number;
  P: number;
  supply: number;
  loopShares: number;
  principal: number;
  credit: number;
  rampWeight: number;
  stop: boolean;
  pendingExit: number;
  cohorts: Cohort[];
  nav0: number;
  // newcomers' share of the reinvest credit and of the current ramp, for own-cost attribution
  newcomer: { c: Cohort; usd: number }[];
  ramp: { c: Cohort | null; amount: number }[];
  // execution costs borne since the last harvest, for a fee on gross yield
  costAcc: number;
}

interface Request {
  vault: VaultKey;
  kind: "delever" | "exit";
  owed: number;
  freed: number;
  charged: number;
  allowance: number;
  debtShare: number;
  collateralOwed: number;
  cohortShares: { c: Cohort; shares: number }[];
}

interface Exit {
  vault: VaultKey;
  at: number;
  shares: number;
  cohortShares: { c: Cohort; shares: number }[];
}

const KEYS: VaultKey[] = ["eth", "btc"];
const MAX_OBS = 120;

export function runPath(p: Params, index: number, math?: StableswapWasm): PathResult {
  const r = rng(p.sim.seed, index);
  const rObs = rng(p.sim.seed ^ 0x5bd1e995, index);
  // a day holds a whole number of steps, so elapsed time matches the horizon
  const stepsPerDay = Math.max(1, Math.round(24 / p.sim.stepHours));
  const stepH = 24 / stepsPerDay;
  const dt = stepH / 8760;
  const days = Math.max(1, Math.round(p.sim.horizonDays));
  const steps = days * stepsPerDay;
  const lev = leverage(p);
  const Lt = Number.isFinite(lev.L) ? lev.L : 1;
  const hfT = lev.hfEff;
  const LT = p.loop.primeLt;
  const solver = p.loop.solverBps / 1e4;
  const fee = p.fees.protocolFeeBps / 1e4;
  const rLoop = p.market.hollarRate * (1 - p.fees.discountLoop);
  const rMain = p.market.hollarRate * (1 - p.fees.discountMain);
  const inc = p.improvements.incentiveBps / 1e4;
  const yNav = p.market.stress === "negCarry" ? p.market.hollarRate - 0.01 : p.market.primeYield;
  const pools: PoolState = { prime: p.pool.prime, hollar: p.pool.hollar, peg: p.market.primePrice, amp: p.pool.amp, fee: p.pool.feeBps / 1e4 };
  const pool: Pool = p.sim.poolMode === "exact" && math ? wasmPool(pools, math) : fastPool(pools);
  const closed = closedCosts(p, 0);
  const { band, otherLeg } = arbSellThreshold(p);
  const otherLegRate = otherLeg / 1e4;
  const desk = p.improvements;
  const attribution = desk.attribution;
  const paths = makePaths(p, r, steps, dt);
  const rho = Math.max(-1, Math.min(1, p.market.corr));
  const monitorH = Math.max(1 / 60, p.market.monitorMinutes / 60);
  const ledger = {
    hollarInterest: 0, collateralFee: 0, lpFees: 0, depositFees: 0, deskPnl: 0, incentiveCost: 0,
    entryCost: 0, unwindCost: 0, harvestCost: 0, solver: 0, arbGross: 0, arbOtherLeg: 0,
    blockedUsd: 0, depositedUsd: 0, withdrawnUsd: 0, entryVolume: 0, unwindVolume: 0, userEarnedUsd: 0,
  };
  const counts = { stallSteps: 0, unwindStallSteps: 0, arbDrySteps: 0, stopSteps: { eth: 0, btc: 0 }, relevers: { eth: 0, btc: 0 }, delevers: { eth: 0, btc: 0 }, minHf: Infinity, maxDef: 0 };

  // loop
  let oracle = p.market.primePrice;
  let A = 0;
  let B = 0;
  let cash = 0;
  let totalShares = 0;
  let owed = 0;
  const requests: Request[] = [];
  const exits: Exit[] = [];
  let arbPrime = p.arb.inventoryPrime;
  let arbHollar = p.arb.inventoryHollar;
  let arbEmptyAt = -1;
  let arbHollarEmptyAt = -1;
  let deskPrime = desk.desk ? desk.deskPrime : 0;
  let deskHollar = 0;
  let budgetIn = p.loop.budgetCap;
  let budgetOut = p.loop.budgetCap;

  const vaults: Record<VaultKey, Vault> = {} as Record<VaultKey, Vault>;
  for (const k of KEYS) {
    const v = p.vaults[k];
    vaults[k] = {
      key: k, Q: v.units, D: 0, mainPrincipal: 0, P: v.price, supply: v.units, loopShares: 0, principal: 0, credit: 0, rampWeight: 0,
      stop: false, pendingExit: 0, cohorts: [{ vault: k, day: 0, usd: v.units * v.price, units: v.units, shares: v.units, exitedUnits: 0, exitedShares: 0 }], nav0: 1,
      newcomer: [], ramp: [], costAcc: 0,
    };
  }
  if (p.sim.initial === "lark4") {
    A = p.loop.collateralUsd / oracle;
    B = p.loop.debtUsd;
    const eq = A * oracle - B;
    const sum = p.vaults.eth.loopEquityUsd + p.vaults.btc.loopEquityUsd;
    for (const k of KEYS) {
      vaults[k].D = p.vaults[k].mainDebt;
      vaults[k].mainPrincipal = p.vaults[k].mainDebt;
      vaults[k].principal = p.vaults[k].loopPrincipal;
      vaults[k].loopShares = sum > 0 ? (eq * p.vaults[k].loopEquityUsd) / sum : 0;
    }
    totalShares = vaults.eth.loopShares + vaults.btc.loopShares;
  }

  const eps = () => (totalShares > 0 ? (A * oracle - B + cash - owed) / totalShares : 1);
  const vaultEquity = (v: Vault) => v.loopShares * eps() + requests.filter((q) => q.vault === v.key && q.kind === "delever").reduce((a, q) => a + q.owed - q.freed - q.charged, 0);
  const vaultDeficitBps = (v: Vault) => (v.D > 0 ? ((v.D - vaultEquity(v)) / v.D) * 1e4 : 0);
  const navUnits = (v: Vault) => (v.supply > 0 ? (v.Q - (v.D - vaultEquity(v)) / v.P) / v.supply : 1);
  // a newcomer's own cost comes out of its own vault shares, so the vault's other holders keep their nav:
  // burn x with (V − usd)/(S − x) = V/S, the loss already in V
  const chargeCohort = (v: Vault, c: Cohort, usd: number) => {
    if (usd <= 0 || v.supply <= 0) return;
    const navUsd = navUnits(v) * v.P;
    const x = Math.min(c.shares - c.exitedShares, (usd * v.supply) / Math.max(1e-12, navUsd * v.supply + usd));
    if (x <= 0) return;
    c.shares -= x;
    v.supply -= x;
  };
  for (const k of KEYS) {
    vaults[k].nav0 = navUnits(vaults[k]);
    vaults[k].cohorts[0].units = vaults[k].cohorts[0].shares * vaults[k].nav0;
  }
  const hf = () => (B > 0 ? (A * oracle * LT) / B : 99);

  const lpFee = (grossOutUsd: number) => { ledger.lpFees += grossOutUsd * pools.fee; };
  const edge = (side: 0 | 1, s: PoolState = pools) => {
    const probe = side === 0 ? 50 / oracle : 50;
    const out = fastQuote(s, side, probe);
    return side === 0 ? ((out - 50) / 50) * 1e4 : ((out * oracle - 50) / 50) * 1e4;
  };
  const sizeTo = (side: 0 | 1, target: number, max: number) => {
    if (max <= 0) return 0;
    const after = (a: number) => {
      const c = { ...pools };
      fastApply(c, side, a);
      return edge(side, c);
    };
    if (after(max) >= target) return max;
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (after(mid) > target) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  // outside arb and treasury desk answer the pool's premium
  const respond = (t: number) => {
    if (desk.desk && desk.deskMode === "peg") {
      const sell = edge(0);
      if (sell > desk.deskSpreadBps && deskPrime > 0) {
        const s = sizeTo(0, desk.deskSpreadBps, deskPrime);
        if (s > 0) {
          const h = pool.apply(0, s);
          lpFee(h / (1 - pools.fee));
          deskPrime -= s;
          deskHollar += h;
          ledger.deskPnl += h - s * oracle;
        }
      }
      const buy = edge(1);
      if (desk.deskBid && buy > desk.deskSpreadBps && deskHollar > 0) {
        const x = sizeTo(1, desk.deskSpreadBps, deskHollar);
        if (x > 0) {
          const out = pool.apply(1, x);
          lpFee((out / (1 - pools.fee)) * oracle);
          deskHollar -= x;
          deskPrime += out;
          ledger.deskPnl += out * oracle - x;
        }
      }
    }
    const sell = edge(0);
    if (sell > band && arbPrime > 1e-6) {
      const s = sizeTo(0, band, arbPrime);
      if (s > 0) {
        const h = pool.apply(0, s);
        lpFee(h / (1 - pools.fee));
        arbPrime -= s;
        arbHollar += h;
        ledger.arbGross += h - s * oracle;
        ledger.arbOtherLeg += otherLegRate * s * oracle;
        if (arbPrime < p.arb.inventoryPrime * 0.05 && arbEmptyAt < 0) arbEmptyAt = t;
      }
    }
    const buy = edge(1);
    if (buy > p.arb.buyBps && arbHollar > 1) {
      const x = sizeTo(1, p.arb.buyBps, arbHollar);
      if (x > 0) {
        const out = pool.apply(1, x);
        lpFee((out / (1 - pools.fee)) * oracle);
        arbHollar -= x;
        arbPrime += out;
        ledger.arbGross += out * oracle - x;
        if (arbHollar < p.arb.inventoryHollar * 0.05 && arbHollarEmptyAt < 0) arbHollarEmptyAt = t;
      }
    }
  };

  const buyPrime = (usd: number): number => {
    if (desk.desk && desk.deskMode === "direct" && deskPrime * oracle >= usd) {
      const out = usd / (oracle * (1 + desk.deskSpreadBps / 1e4));
      deskPrime -= out;
      deskHollar += usd;
      ledger.deskPnl += usd - out * oracle;
      return out;
    }
    const out = pool.apply(1, usd);
    lpFee((out / (1 - pools.fee)) * oracle);
    return out;
  };
  const sellPrime = (s: number): number => {
    if (desk.desk && desk.deskMode === "direct" && desk.deskBid && deskHollar >= s * oracle) {
      const h = s * oracle * (1 - desk.deskSpreadBps / 1e4);
      deskHollar -= h;
      deskPrime += s;
      ledger.deskPnl += s * oracle - h;
      return h;
    }
    const h = pool.apply(0, s);
    lpFee(h / (1 - pools.fee));
    return h;
  };
  const quoteBuy = (usd: number): number => {
    if (desk.desk && desk.deskMode === "direct" && deskPrime * oracle >= usd) return usd / (oracle * (1 + desk.deskSpreadBps / 1e4));
    return pool.quote(1, usd);
  };

  const loopDeposit = (v: Vault, amount: number, c: Cohort | null = null) => {
    if (amount <= 0) return;
    const e = eps();
    const net = attribution === "swing" ? amount * (1 - (closed.entryBps / 1e4) * Lt) : amount;
    const shares = totalShares > 0 && e > 0 ? net / e : amount;
    v.loopShares += shares;
    totalShares += shares;
    v.principal += amount;
    v.rampWeight += amount;
    v.ramp.push({ c, amount });
    cash += amount;
    if (c && amount > net) chargeCohort(v, c, amount - net);
  };
  const requestUnwind = (v: Vault, equity: number, kind: Request["kind"], extra?: Partial<Request>) => {
    const e = eps();
    if (equity <= 0 || e <= 0 || v.loopShares <= 0) return;
    const burn = Math.min(v.loopShares, equity / e);
    const amount = burn * e;
    const basis = v.loopShares > 0 ? (v.principal * burn) / v.loopShares : 0;
    v.loopShares -= burn;
    totalShares -= burn;
    v.principal -= basis;
    owed += amount;
    requests.push({ vault: v.key, kind, owed: amount, freed: 0, charged: 0, allowance: Math.max(0, amount - basis), debtShare: 0, collateralOwed: 0, cohortShares: [], ...extra });
  };
  const repayMain = (v: Vault, amount: number) => {
    const x = Math.min(amount, v.D);
    if (v.D > 0) v.mainPrincipal *= 1 - x / v.D;
    v.D -= x;
  };
  const borrowMain = (v: Vault, amount: number) => {
    v.D += amount;
    v.mainPrincipal += amount;
  };
  const settle = (q: Request, amount: number) => {
    const v = vaults[q.vault];
    q.freed += amount;
    if (q.kind === "delever") repayMain(v, amount);
  };
  const finishExit = (q: Request, feeCut = 0) => {
    const v = vaults[q.vault];
    // freed loop equity repays the exit's Main slice; a shortfall comes out of its collateral
    const valueUsd = q.collateralOwed * v.P + (q.freed - q.debtShare) - feeCut;
    ledger.withdrawnUsd += valueUsd;
    const total = q.cohortShares.reduce((a, x) => a + x.shares, 0) || 1;
    for (const x of q.cohortShares) x.c.exitedUnits += (valueUsd * x.shares) / total / v.P;
  };
  // the protocol fee on an unwound slice's own yield is paid when its claim closes
  const closeRequest = (q: Request) => {
    const v = vaults[q.vault];
    const feeCut = fee * Math.max(0, q.allowance - q.charged);
    ledger.collateralFee += feeCut;
    if (q.kind === "exit") finishExit(q, feeCut);
    else {
      v.D += feeCut;
      v.mainPrincipal += feeCut;
    }
  };
  // a cost every loop share bears, split by holding
  const shareCost = (usd: number) => {
    if (usd <= 0 || totalShares <= 0) return;
    for (const k of KEYS) vaults[k].costAcc += (usd * vaults[k].loopShares) / totalShares;
  };

  const series = new Float32Array(days * SERIES.length);
  const startPrice = { eth: vaults.eth.P, btc: vaults.btc.P };
  const tvl0 = KEYS.reduce((a, k) => a + vaults[k].Q * vaults[k].P, 0);
  const meanSize = p.flows.sizeMedianUsd * Math.exp((p.flows.sizeSigma * p.flows.sizeSigma) / 2);
  const horizonYears = days / 365;
  let costCum = 0;
  let protocolCum = 0;

  for (let i = 0; i < steps; i++) {
    const t = i * stepH;
    const day = i / stepsPerDay;
    // 1. prices
    const P0 = { eth: vaults.eth.P, btc: vaults.btc.P };
    const sf = stressFactor(p, day) / stressFactor(p, Math.max(0, day - 1 / stepsPerDay));
    vaults.eth.P *= Math.exp(paths.eth[i]) * sf;
    vaults.btc.P *= Math.exp(paths.btc[i]) * sf;
    oracle *= Math.exp(yNav * dt);
    if (p.market.stress === "oracleStep" && i === Math.round(p.market.stressDay * stepsPerDay)) oracle *= 0.99;
    pools.peg = oracle;

    // 2. accrue
    const loopInt = B * (Math.exp(rLoop * dt) - 1);
    B += loopInt;
    let mainInt = 0;
    for (const k of KEYS) {
      const d = vaults[k].D * (Math.exp(rMain * dt) - 1);
      vaults[k].D += d;
      mainInt += d;
      for (const q of requests) if (q.vault === k && q.kind === "exit") q.debtShare *= Math.exp(rMain * dt);
    }
    ledger.hollarInterest += loopInt + mainInt;
    if (inc > 0) {
      A *= Math.exp(inc * dt);
      ledger.incentiveCost += (desk.incentiveScope === "blanket" ? Math.max(A, desk.blanketPrime) : A) * oracle * inc * dt;
    }
    budgetIn = Math.min(p.loop.budgetCap + p.loop.budgetRefillPerSec * 3600 * stepH, budgetIn + p.loop.budgetRefillPerSec * 3600 * stepH);
    budgetOut = Math.min(p.loop.budgetCap + p.loop.budgetRefillPerSec * 3600 * stepH, budgetOut + p.loop.budgetRefillPerSec * 3600 * stepH);
    // the arb restocks whichever side ran dry, after its refill delay
    if (arbEmptyAt >= 0 || arbHollarEmptyAt >= 0) counts.arbDrySteps++;
    if (arbEmptyAt >= 0 && p.arb.refillHours > 0 && t - arbEmptyAt >= p.arb.refillHours) {
      arbPrime = Math.max(arbPrime, p.arb.inventoryPrime);
      arbEmptyAt = -1;
    }
    if (arbHollarEmptyAt >= 0 && p.arb.refillHours > 0 && t - arbHollarEmptyAt >= p.arb.refillHours) {
      arbHollar = Math.max(arbHollar, p.arb.inventoryHollar);
      arbHollarEmptyAt = -1;
    }

    // 3. flows
    for (const k of KEYS) {
      const v = vaults[k];
      const tvl = v.Q * v.P;
      const growth = p.flows.growth === "none" ? 0
        : p.flows.growth === "linear" ? (tvl0 * (p.vaults[k].units * p.vaults[k].price / tvl0) * Math.max(0, p.flows.growthFactor - 1)) / horizonYears
        : tvl * Math.log(Math.max(1, p.flows.growthFactor)) / horizonYears;
      const expected = (p.vaults[k].inflowUsd + growth) * dt;
      const n = poisson(r, expected / meanSize);
      let amount = 0;
      for (let j = 0; j < n; j++) amount += p.flows.sizeMedianUsd * Math.exp(p.flows.sizeSigma * r.normal());
      if (amount > 0) {
        const blocked = v.stop || vaultDeficitBps(v) > p.policy.admissionBps;
        let room = amount;
        if (p.vaults[k].capOn) room = Math.min(amount, Math.max(0, (p.vaults[k].tvlCap - v.Q) * v.P));
        if (blocked || room <= 0) {
          ledger.blockedUsd += amount;
        } else {
          ledger.blockedUsd += amount - room;
          const feeRate = p.depositFee.on ? (p.depositFee.auto ? (closed.entryBps / 1e4) * Lt * p.vaults[k].bandTarget : p.depositFee.bps / 1e4) : 0;
          const feeUsd = room * feeRate;
          if (p.depositFee.dest === "protocol") ledger.depositFees += feeUsd;
          else cash += feeUsd;
          const net = room - feeUsd;
          const units = net / v.P;
          const nav = attribution === "pooled" ? v.Q / v.supply : navUnits(v);
          const shares = nav > 0 ? units / nav : units;
          v.Q += units;
          v.supply += shares;
          v.credit += net;
          ledger.depositedUsd += room;
          const last = v.cohorts[v.cohorts.length - 1];
          const d = Math.floor(day);
          if (last.day === d && d > 0) {
            last.usd += room;
            last.units += room / v.P;
            last.shares += shares;
          } else v.cohorts.push({ vault: k, day: d, usd: room, units: room / v.P, shares, exitedUnits: 0, exitedShares: 0 });
          v.newcomer.push({ c: v.cohorts[v.cohorts.length - 1], usd: net });
        }
      }
      // withdrawals: requests arrive like deposits, pro rata across cohorts, and pay out after the cooldown
      const freeUsd = navUnits(v) * v.P * Math.max(0, v.supply - v.pendingExit);
      const asks = p.vaults[k].outflowRate > 0 && freeUsd > 0 ? poisson(r, (p.vaults[k].outflowRate * freeUsd * dt) / meanSize) : 0;
      let askUsd = 0;
      for (let j = 0; j < asks; j++) askUsd += p.flows.sizeMedianUsd * Math.exp(p.flows.sizeSigma * r.normal());
      const rate = freeUsd > 0 ? Math.min(1, askUsd / freeUsd) : 0;
      if (rate > 0) {
        const cs = v.cohorts.map((c) => ({ c, shares: (c.shares - c.exitedShares) * rate })).filter((x) => x.shares > 0);
        const shares = cs.reduce((a, x) => a + x.shares, 0);
        if (shares > 0) {
          for (const x of cs) x.c.exitedShares += x.shares;
          v.pendingExit += shares;
          exits.push({ vault: k, at: t + p.policy.cooldownHours, shares, cohortShares: cs });
        }
      }
    }
    while (exits.length && exits[0].at <= t) {
      const x = exits.shift()!;
      const v = vaults[x.vault];
      const frac = Math.min(1, x.shares / v.supply);
      const collateralOwed = v.Q * frac;
      const debtShare = v.D * frac;
      const equity = v.loopShares * eps() * frac;
      v.Q -= collateralOwed;
      repayMain(v, debtShare);
      v.supply -= x.shares;
      v.pendingExit -= x.shares;
      requestUnwind(v, equity, "exit", { debtShare, collateralOwed, cohortShares: x.cohortShares });
      if (equity <= 0) finishExit({ vault: x.vault, kind: "exit", owed: 0, freed: 0, charged: 0, allowance: 0, debtShare, collateralOwed, cohortShares: x.cohortShares });
    }

    // 4. harvest the loop-wide surplus above principal into collateral; queued unwinds keep their
    // reserved equity (eps nets `owed`) but don't block it, as in SubLoop._harvestable
    {
      const e = eps();
      const principalAll = vaults.eth.principal + vaults.btc.principal;
      const owned = KEYS.map((k) => Math.max(0, vaults[k].loopShares * e - vaults[k].principal));
      const weight = owned.reduce((a, b) => a + b, 0);
      // SubLoop.executionCostReserve: a slice of the gross aPRIME stays as earned surplus
      const available = totalShares * e - principalAll - A * oracle * (p.policy.costReserveBps / 1e4);
      const open = available > principalAll * (p.policy.harvestThresholdBps / 1e4) && available > 0.01 && weight > 0;
      const capacity = open ? Math.min(available, weight) : 0;
      let harvested = 0;
      for (const [i, k] of KEYS.entries()) {
        const v = vaults[k];
        const surplus = capacity > 0 ? (capacity * owned[i]) / weight : 0;
        if (surplus > 0.01) {
          v.loopShares -= surplus / e;
          totalShares -= surplus / e;
          harvested += surplus;
          const swap = surplus * (p.costs.harvestSwapBps / 1e4);
          const due = Math.max(0, v.D - v.mainPrincipal);
          // contracts: the whole harvest; yield: after the vault's interest; gross: before trading costs too
          const base = p.fees.feeBase === "contract" ? surplus - swap
            : p.fees.feeBase === "yield" ? surplus - swap - due
            : surplus - swap - due + v.costAcc;
          const protocolCut = Math.min(surplus - swap, Math.max(0, base)) * fee;
          v.costAcc = 0;
          let net = surplus - swap - protocolCut;
          // Main interest is serviced from the harvest before anything compounds
          const service = Math.min(due, net);
          if (service > 0) {
            const serviceSwap = service * (p.costs.harvestSwapBps / 1e4);
            v.D -= service - serviceSwap;
            net -= service;
            ledger.harvestCost += serviceSwap;
          }
          ledger.harvestCost += swap;
          ledger.collateralFee += protocolCut;
          ledger.userEarnedUsd += net;
          v.Q += net / v.P;
          v.credit += net;
        }
      }
      if (harvested > 0) A -= harvested / oracle;
    }

    // 5. vault rebalancing: reinvest credit, then resize at each keeper observation in this step.
    // observations between steps see a brownian bridge from the step's start price to its end price
    const obs: number[] = [];
    {
      const first = Math.floor(t / monitorH + 1e-9) + 1;
      const last = Math.floor((t + stepH) / monitorH + 1e-9);
      const m = last - first + 1;
      const every = Math.max(1, Math.ceil(m / MAX_OBS));
      for (let j = last; j >= first; j -= every) obs.unshift(Math.min(1, (j * monitorH - t) / stepH));
    }
    const seen: Record<VaultKey, number[]> = { eth: [], btc: [] };
    if (obs.length) {
      const T = stepH / 8760;
      const x = { eth: Math.log(P0.eth), btc: Math.log(P0.btc) };
      const end = { eth: Math.log(vaults.eth.P), btc: Math.log(vaults.btc.P) };
      let prev = 0;
      for (const f of obs) {
        if (f >= 1 - 1e-9) {
          for (const k of KEYS) seen[k].push(vaults[k].P);
          continue;
        }
        const z1 = rObs.normal();
        const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * rObs.normal();
        for (const [j, k] of KEYS.entries()) {
          const mean = x[k] + (end[k] - x[k]) * ((f - prev) / (1 - prev));
          const sd = p.vaults[k].vol * Math.sqrt((T * (f - prev) * (1 - f)) / (1 - prev));
          x[k] = mean + sd * (j ? z2 : z1);
          seen[k].push(Math.exp(x[k]));
        }
        prev = f;
      }
    }
    for (const k of KEYS) {
      const v = vaults[k];
      const pv = p.vaults[k];
      // a committed de-lever settles before anything else (CollateralVault.rebalance)
      if (requests.some((q) => q.vault === k && q.kind === "delever")) continue;
      if (v.credit > 0) {
        const value = v.Q * v.P;
        const add = Math.max(0, Math.min(v.credit * pv.bandTarget, pv.bandTarget * value - v.D));
        borrowMain(v, add);
        let rest = add;
        for (const n of v.newcomer) {
          const part = add * Math.min(1, n.usd / v.credit);
          loopDeposit(v, part, n.c);
          rest -= part;
        }
        loopDeposit(v, Math.max(0, rest));
        v.credit = 0;
        v.newcomer = [];
      }
      // waiting or unsettled exits pause price resizing
      if (v.pendingExit > 0 || requests.some((q) => q.vault === k)) continue;
      for (const price of seen[k]) {
        const value = v.Q * price;
        const ltv = value > 0 ? v.D / value : 0;
        if (ltv < pv.bandLo) {
          const add = pv.bandTarget * value - v.D;
          borrowMain(v, add);
          loopDeposit(v, add);
          counts.relevers[k]++;
        } else if (ltv > pv.bandHi) {
          requestUnwind(v, Math.min(v.D - pv.bandTarget * value, vaultEquity(v)), "delever");
          counts.delevers[k]++;
          break;
        }
      }
    }

    // 6. loop: matched flows, unwinds, entries
    for (const q of requests) {
      if (!p.improvements.matching || cash <= 0) break;
      const need = q.owed - q.freed - q.charged;
      const m = Math.min(cash, need);
      if (m <= 0) continue;
      cash -= m;
      owed -= m;
      settle(q, m);
    }
    while (requests.length && A > 0 && budgetOut > 1) {
      const q = requests[0];
      const need = q.owed - q.freed - q.charged;
      if (need <= 0.005) {
        owed -= Math.max(0, need);
        requests.shift();
        closeRequest(q);
        continue;
      }
      const position = A * oracle - B;
      const Lcur = position > 0 ? (A * oracle) / position : Lt;
      const s = Math.min(A, (need * Lcur) / oracle, p.loop.tranche / oracle, budgetOut / oracle);
      // unwinds go through the same capped lane as entries
      const direct = desk.desk && desk.deskMode === "direct" && desk.deskBid && deskHollar >= s * oracle;
      const hq = (direct ? s * oracle * (1 - desk.deskSpreadBps / 1e4) : pool.quote(0, s)) * (1 - solver);
      if ((1 - hq / (s * oracle)) * 1e4 > p.loop.laneCapBps) {
        counts.unwindStallSteps++;
        break;
      }
      const h = sellPrime(s) * (1 - solver);
      budgetOut -= s * oracle;
      ledger.unwindVolume += s * oracle;
      A -= s;
      const cost = s * oracle - h;
      ledger.unwindCost += cost;
      const repay = Math.min(h, Math.max(0, B - (A * oracle * LT) / hfT));
      B -= repay;
      const freed = h - repay;
      // who bears the execution cost
      const chargeable = cost <= 0 ? 0 : attribution === "pooled" ? Math.max(0, Math.min(cost, q.allowance - q.charged)) : cost;
      shareCost(cost - chargeable);
      if (q.kind === "delever") vaults[q.vault].costAcc += chargeable;
      q.charged += chargeable;
      owed -= chargeable;
      const pay = Math.min(freed, q.owed - q.freed - q.charged);
      owed -= pay;
      settle(q, pay);
      if (freed > pay) B = Math.max(0, B - (freed - pay));
      respond(t);
    }
    // entries: deploy cash, then borrow up to the target leverage
    let stalled = false;
    for (let guard = 0; guard < 400; guard++) {
      const position = A * oracle - B + cash;
      const exposure = A * oracle;
      const borrowAllowed = !requests.length;
      const need = Math.max(borrowAllowed ? Lt * position - exposure : cash, 0);
      const T = Math.min(p.loop.tranche, need, budgetIn);
      if (T < Math.min(1, p.loop.tranche * 0.02)) break;
      const out = quoteBuy(T) * (1 - solver);
      const shortfall = (1 - (out * oracle) / T) * 1e4;
      if (shortfall > p.loop.laneCapBps) {
        stalled = true;
        break;
      }
      const got = buyPrime(T) * (1 - solver);
      const fromCash = Math.min(cash, T);
      cash -= fromCash;
      B += T - fromCash;
      A += got;
      budgetIn -= T;
      const cost = T - got * oracle;
      ledger.entryCost += cost;
      ledger.entryVolume += T;
      ledger.solver += (got / (1 - solver)) * solver * oracle;
      const w = KEYS.reduce((a, k) => a + vaults[k].rampWeight, 0);
      if (attribution === "own" && w > 0) {
        const e = (A * oracle - B + cash - owed + cost) / Math.max(1e-9, totalShares);
        for (const k of KEYS) {
          const v = vaults[k];
          const share = (cost * v.rampWeight) / w;
          const burn = Math.min(v.loopShares, share / e);
          v.loopShares -= burn;
          totalShares -= burn;
          v.costAcc += share;
          // within the vault, a newcomer's slice of the ramp is its own cost
          for (const part of v.ramp) if (part.c && v.rampWeight > 0) chargeCohort(v, part.c, (share * part.amount) / v.rampWeight);
        }
      } else shareCost(cost);
      respond(t);
    }
    if (stalled) counts.stallSteps++;
    if (A * oracle - B + cash > 0 && Lt * (A * oracle - B + cash) - A * oracle < p.loop.tranche) for (const k of KEYS) {
      vaults[k].rampWeight = 0;
      vaults[k].ramp = [];
    }
    // safety: restore the target HF after a PRIME drop
    if (hf() < hfT - 0.02 && A > 0) {
      const target = (B - (A * oracle * LT) / hfT) / (1 - LT / hfT);
      const s = Math.min(A, Math.max(0, target) / oracle);
      const capped = s > 0 && (1 - pool.quote(0, s) / (s * oracle)) * 1e4 > p.loop.laneCapBps && hf() > 1.02;
      if (s > 0 && !capped) {
        const h = sellPrime(s);
        A -= s;
        B = Math.max(0, B - h);
        ledger.unwindCost += s * oracle - h;
        shareCost(s * oracle - h);
      }
    }
    respond(t);

    // 7. keeper deposit stops
    for (const k of KEYS) {
      const v = vaults[k];
      const d = vaultDeficitBps(v);
      if (d > p.policy.stopBps) v.stop = true;
      else if (d < p.policy.resumeBps) v.stop = false;
      if (v.stop) counts.stopSteps[k]++;
    }
    counts.minHf = Math.min(counts.minHf, hf());
    const principal = vaults.eth.principal + vaults.btc.principal;
    const loopDef = principal > 0 ? ((principal - (A * oracle - B + cash - owed)) / principal) * 1e4 : 0;
    counts.maxDef = Math.max(counts.maxDef, loopDef);

    // 8. daily record
    if ((i + 1) % stepsPerDay === 0) {
      const d = (i + 1) / stepsPerDay - 1;
      costCum = ledger.entryCost + ledger.unwindCost + ledger.harvestCost;
      protocolCum = ledger.hollarInterest + ledger.collateralFee + ledger.lpFees + ledger.depositFees + ledger.deskPnl - ledger.incentiveCost;
      const row = d * SERIES.length;
      const position = A * oracle - B;
      const vals: Record<SeriesKey, number> = {
        priceEth: vaults.eth.P / startPrice.eth,
        priceBtc: vaults.btc.P / startPrice.btc,
        prime: oracle,
        loopDeficit: loopDef,
        defEth: vaultDeficitBps(vaults.eth),
        defBtc: vaultDeficitBps(vaults.btc),
        ltvEth: vaults.eth.Q > 0 ? vaults.eth.D / (vaults.eth.Q * vaults.eth.P) : 0,
        ltvBtc: vaults.btc.Q > 0 ? vaults.btc.D / (vaults.btc.Q * vaults.btc.P) : 0,
        hf: Math.min(hf(), 5),
        lev: position > 0 ? (A * oracle) / position : 0,
        premium: edge(0),
        arbPrime,
        navEth: navUnits(vaults.eth) / vaults.eth.nav0,
        navBtc: navUnits(vaults.btc) / vaults.btc.nav0,
        protocolCum,
        costCum,
        stopEth: vaults.eth.stop ? 1 : 0,
        stopBtc: vaults.btc.stop ? 1 : 0,
        tvl: vaults.eth.Q * vaults.eth.P + vaults.btc.Q * vaults.btc.P,
      };
      SERIES.forEach((key, j) => { series[row + j] = vals[key]; });
    }
  }

  const years = days / 365;
  const apr = (v: Vault) => {
    const ratio = navUnits(v) / v.nav0;
    return ratio > 0 ? Math.log(ratio) / years : -1;
  };
  const cohorts = KEYS.flatMap((k) => {
    const v = vaults[k];
    const nav = navUnits(v);
    // claims not yet paid: shares still in their cooldown at nav, unwinds in flight at what they're owed
    const pending = new Map<Cohort, number>();
    const add = (c: Cohort, units: number) => pending.set(c, (pending.get(c) ?? 0) + units);
    for (const x of exits) if (x.vault === k) for (const cs of x.cohortShares) add(cs.c, cs.shares * nav);
    for (const q of requests) {
      if (q.vault !== k || q.kind !== "exit") continue;
      const usd = q.collateralOwed * v.P + (q.owed - q.charged) - q.debtShare - fee * Math.max(0, q.allowance - q.charged);
      const total = q.cohortShares.reduce((a, cs) => a + cs.shares, 0) || 1;
      for (const cs of q.cohortShares) add(cs.c, (usd * cs.shares) / total / v.P);
    }
    return v.cohorts.filter((c) => c.usd > 0).map((c) => {
      const held = Math.max(1, days - c.day);
      // collateral units at the end (held + owed + paid out) vs units brought in
      const endUnits = (c.shares - c.exitedShares) * nav + c.exitedUnits + (pending.get(c) ?? 0);
      return { vault: k, day: c.day, usd: c.usd, heldDays: held, apr: c.units > 0 ? Math.log(Math.max(1e-9, endUnits / c.units)) / (held / 365) : 0 };
    });
  });

  const summary: PathSummary = {
    aprEth: apr(vaults.eth),
    aprBtc: apr(vaults.btc),
    protocol: protocolCum / years,
    hollarInterest: ledger.hollarInterest / years,
    collateralFee: ledger.collateralFee / years,
    lpFees: ledger.lpFees / years,
    depositFees: ledger.depositFees / years,
    deskPnl: ledger.deskPnl / years,
    incentiveCost: ledger.incentiveCost / years,
    entryCost: ledger.entryCost / years,
    unwindCost: ledger.unwindCost / years,
    harvestCost: ledger.harvestCost / years,
    solver: ledger.solver / years,
    arbGross: ledger.arbGross / years,
    arbOtherLeg: ledger.arbOtherLeg / years,
    maxLoopDeficitBps: counts.maxDef,
    endLoopDeficitBps: series[(days - 1) * SERIES.length + SERIES_INDEX.loopDeficit],
    stopHoursEth: counts.stopSteps.eth * stepH,
    stopHoursBtc: counts.stopSteps.btc * stepH,
    blockedUsd: ledger.blockedUsd,
    depositedUsd: ledger.depositedUsd,
    withdrawnUsd: ledger.withdrawnUsd,
    stallHours: counts.stallSteps * stepH,
    unwindStallHours: counts.unwindStallSteps * stepH,
    arbDryHours: counts.arbDrySteps * stepH,
    releversEth: counts.relevers.eth / years,
    deleversEth: counts.delevers.eth / years,
    releversBtc: counts.relevers.btc / years,
    deleversBtc: counts.delevers.btc / years,
    minHf: counts.minHf,
    entryVolume: ledger.entryVolume / years,
    unwindVolume: ledger.unwindVolume / years,
    entryAvgBps: ledger.entryVolume > 0 ? (ledger.entryCost / ledger.entryVolume) * 1e4 : 0,
    unwindAvgBps: ledger.unwindVolume > 0 ? (ledger.unwindCost / ledger.unwindVolume) * 1e4 : 0,
    userEarnedUsd: ledger.userEarnedUsd / years,
    cohorts,
  };
  return { series, days, summary };
}
