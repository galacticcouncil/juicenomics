import lark4 from "../../data/lark4.json";
import type { Params, VaultParams } from "./types";

const v = lark4.vaults;

const vault = (key: "eth" | "btc", vol: number, inKindYield: number): VaultParams => ({
  name: v[key].name,
  collateral: v[key].collateral,
  units: v[key].units,
  price: v[key].price,
  vol,
  drift: 0,
  inKindYield,
  maxLtv: v[key].ltv,
  lt: v[key].lt,
  bandLo: v[key].ltv - 0.05,
  bandTarget: v[key].ltv,
  bandHi: v[key].ltv + 0.03,
  capOn: true,
  tvlCap: v[key].tvlCap,
  inflowUsd: 0,
  outflowRate: 0,
  mainDebt: v[key].mainDebt,
  loopPrincipal: v[key].loopPrincipal,
  loopEquityUsd: v[key].loopEquityUsd,
});

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
    protocolFeeBps: v.eth.protocolFeeBps,
    discountMain: lark4.discountBps / 1e4,
    discountLoop: 0,
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
    cooldownHours: v.eth.withdrawalDelay / 3600,
    harvestThresholdBps: lark4.loop.harvestThreshold * 1e4,
    costReserveBps: lark4.loop.dcaSlippagePpm / 100,
  },
  flows: { growth: "none", growthFactor: 1, sizeMedianUsd: 5_000, sizeSigma: 1.2 },
  sim: { horizonDays: 365, stepHours: 1, paths: 200, seed: 7, poolMode: "fast", initial: "fresh", stateBlock: lark4.evmBlock },
}) as Params;

export const SNAPSHOT = { evmBlock: lark4.evmBlock, timestamp: lark4.timestamp, source: lark4.source, pegs: lark4.pool143.pegs };

export function clone<T>(x: T): T {
  return structuredClone(x);
}
