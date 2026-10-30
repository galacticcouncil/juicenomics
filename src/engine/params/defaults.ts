import lark4 from "../../data/lark4.json";
import type { Params, VaultParams } from "./types";

const v = lark4.vaults;

// SubLoop.rebalanceBand gaps, bps off the collateral's max LTV
const bp = (x: number) => Math.round(x * 1e4) / 1e4;
const vault = (key: "eth" | "btc", vol: number, inKindYield: number): VaultParams => {
  const s = v[key];
  const target = bp(s.ltv - s.band.targetGap / 1e4);
  return {
    on: s.deployed,
    name: s.name,
    collateral: s.collateral,
    units: s.units,
    price: s.price,
    vol,
    drift: 0,
    inKindYield,
    maxLtv: s.ltv,
    lt: s.lt,
    bandLo: bp(target - s.band.relever / 1e4),
    bandTarget: target,
    bandHi: bp(target + s.band.delever / 1e4),
    capOn: true,
    tvlCap: s.tvlCap,
    inflowUsd: 0,
    outflowRate: 0,
    mainDebt: s.mainDebt,
    loopPrincipal: s.loopPrincipal,
    loopEquityUsd: s.loopEquityUsd,
  };
};

// the live Lark 4 configuration; vols and the PRIME yield come from a year of mainnet oracle history
export const LARK4: Params = Object.freeze({
  v: 1,
  market: {
    primeYield: 0.0593,
    primePrice: lark4.prime.price,
    hollarRate: lark4.hollar.borrowApr,
    hollarMark: 0.9992,
    corr: 0.87,
    pathModel: "gbm",
    stress: "none",
    stressDay: 20,
    jumps: false,
    monitorMinutes: 15,
    // mainnet facilitator bucket 13M, level 10.87M at EVM block 16,035,040 (21 Oct)
    hollarHeadroomUsd: 2_131_869,
  },
  loop: {
    mode: "hf",
    targetHf: lark4.loop.targetHf,
    leverage: 6.05,
    hfLag: 0.004,
    primeLt: lark4.prime.lt,
    tranche: lark4.loop.deployTranche,
    solverBps: 1,
    laneCapBps: 27,
    budgetCap: 25_000,
    budgetRefillPerSec: 50,
    paceSec: 60,
    collateralUsd: lark4.loop.collateralUsd,
    debtUsd: lark4.loop.debtUsd,
  },
  vaults: { eth: vault("eth", 0.57, 0.015), btc: vault("btc", 0.412, 0) },
  pool: {
    prime: lark4.pool143.prime,
    hollar: lark4.pool143.hollar,
    amp: lark4.pool143.amp,
    feeBps: lark4.pool143.feePpm / 100,
  },
  arb: {
    mode: "fixed",
    sellBps: 15,
    buyBps: 4,
    exit10kBps: 14.9,
    exit100kBps: 52.1,
    fixedUsd: 3.5,
    tradeUsd: 10_000,
    marginBps: 0.5,
    inventoryPrime: 500_000,
    inventoryHollar: 500_000,
    refillHours: 24,
  },
  costs: { mode: "derived", entryBps: 24.5, unwindBps: 8.5, harvestSwapBps: 20, churnModel: "pool" },
  fees: {
    protocolFeeBps: v.btc.protocolFeeBps,
    discountMain: lark4.discount.mainBps / 1e4,
    discountLoop: lark4.discount.loopBps / 1e4,
    loopDiscountCapUsd: lark4.discount.loopCap,
    feeBase: "contract",
  },
  depositFee: { on: false, auto: false, bps: 0, dest: "loop" },
  improvements: {
    desk: false,
    deskMode: "peg",
    deskPrime: 886_340,
    deskSpreadBps: 0,
    deskBid: true,
    incentiveBps: 0,
    incentiveScope: "targeted",
    blanketPrime: 7_167_388,
    attribution: "pooled",
    matching: false,
  },
  policy: {
    admissionBps: lark4.loop.admissionMaxDeficitBps,
    stopBps: 250,
    resumeBps: 200,
    cooldownHours: v.btc.withdrawalDelay / 3600,
    harvestThresholdBps: lark4.loop.harvestThreshold * 1e4,
    costReserveBps: lark4.loop.dcaSlippagePpm / 100,
    headroomOn: v.btc.exitHeadroom.enabled,
    headroomGapBps: v.btc.exitHeadroom.gapBps,
    // what each Main ledger was funded with; a live load reads what is left
    reserveUsd: 1000,
  },
  flows: { growth: "none", growthFactor: 1, sizeMedianUsd: 5_000, sizeSigma: 1.2 },
  sim: { horizonDays: 365, stepHours: 1, paths: 200, seed: 7, poolMode: "fast", initial: "fresh", stateBlock: lark4.evmBlock },
}) as Params;

export const SNAPSHOT = { evmBlock: lark4.evmBlock, timestamp: lark4.timestamp, source: lark4.source, genesis: lark4.genesis, pegs: lark4.pool143.pegs };

export function clone<T>(x: T): T {
  return structuredClone(x);
}
