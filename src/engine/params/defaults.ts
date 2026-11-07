import lark0 from "../../data/lark0.json";
import lark4 from "../../data/lark4.json";
import mainnet from "../../data/mainnet.json";
import type { DeploymentKey, Params, VaultKey, VaultParams } from "./types";

interface SnapshotVault {
  name: string;
  collateral: string;
  deployed: boolean;
  price: number;
  ltv: number;
  lt: number;
  units: number;
  tvlCap: number;
  withdrawalDelay: number;
  mainDebt: number;
  loopPrincipal: number;
  loopEquityUsd: number;
  protocolFeeBps: number;
  protocolReserve?: number;
  band: { targetGap: number; relever: number; delever: number };
  exitHeadroom: { enabled: boolean; gapBps: number };
}

/** what scripts/snapshot-lark.mjs reads from a deployment */
export interface Snapshot {
  source: string;
  genesis: string;
  evmBlock: number;
  timestamp: number;
  prime: { price: number; lt: number };
  hollar: { borrowApr: number; headroom?: number };
  discount: { mainBps: number; loopBps: number; loopCap: number };
  loop: { collateralUsd: number; debtUsd: number; targetHf: number; harvestThreshold: number; deployTranche: number; dcaSlippagePpm: number; admissionMaxDeficitBps: number };
  vaults: Record<VaultKey, SnapshotVault>;
  pool143: { feePpm: number; amp: number; prime: number; hollar: number; pegs: string[][] };
  execution?: { laneCapBps: number; budgetCap: number; refillPerSec: number; paceSec: number };
}

// lark4.json predates the lane fields; its controller reads 27 bps, 25k, 50 / s and 60 s (3 Nov)
const LARK4_LANE = { laneCapBps: 27, budgetCap: 25_000, refillPerSec: 50, paceSec: 60 };

// SubLoop.rebalanceBand gaps, bps off the collateral's max LTV
const bp = (x: number) => Math.round(x * 1e4) / 1e4;
const vault = (s: SnapshotVault, vol: number, inKindYield: number): VaultParams => {
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

// a deployment's live configuration; vols and the PRIME yield come from a year of mainnet oracle history
function fromSnapshot(deployment: DeploymentKey, s: Snapshot): Params {
  const v = s.vaults;
  // fee, cooldown and headroom exits are one setting for both vaults: the deployed vault's
  const live = v.eth.deployed ? v.eth : v.btc;
  const lane = s.execution ?? LARK4_LANE;
  return {
    v: 1,
    deployment,
    market: {
      primeYield: 0.0593,
      primePrice: s.prime.price,
      hollarRate: s.hollar.borrowApr,
      hollarMark: 0.9992,
      corr: 0.87,
      pathModel: "gbm",
      stress: "none",
      stressDay: 20,
      jumps: false,
      monitorMinutes: 15,
      // mainnet facilitator bucket 13M, level 10.87M at EVM block 16,035,040 (21 Oct)
      hollarHeadroomUsd: s.hollar.headroom ?? 2_131_869,
    },
    loop: {
      mode: "hf",
      targetHf: s.loop.targetHf,
      leverage: 6.05,
      hfLag: 0.004,
      primeLt: s.prime.lt,
      tranche: s.loop.deployTranche,
      solverBps: 1,
      laneCapBps: lane.laneCapBps,
      budgetCap: lane.budgetCap,
      budgetRefillPerSec: lane.refillPerSec,
      paceSec: lane.paceSec,
      collateralUsd: s.loop.collateralUsd,
      debtUsd: s.loop.debtUsd,
    },
    vaults: { eth: vault(v.eth, 0.57, 0.015), btc: vault(v.btc, 0.412, 0) },
    pool: {
      prime: s.pool143.prime,
      hollar: s.pool143.hollar,
      amp: s.pool143.amp,
      feeBps: s.pool143.feePpm / 100,
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
      protocolFeeBps: live.protocolFeeBps,
      discountMain: s.discount.mainBps / 1e4,
      discountLoop: s.discount.loopBps / 1e4,
      loopDiscountCapUsd: s.discount.loopCap,
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
      admissionBps: s.loop.admissionMaxDeficitBps,
      stopBps: 250,
      resumeBps: 200,
      cooldownHours: live.withdrawalDelay / 3600,
      harvestThresholdBps: s.loop.harvestThreshold * 1e4,
      costReserveBps: s.loop.dcaSlippagePpm / 100,
      headroomOn: live.exitHeadroom.enabled,
      headroomGapBps: live.exitHeadroom.gapBps,
      // what each Main ledger was funded with; a live load reads what is left
      reserveUsd: live.protocolReserve ?? 1000,
    },
    flows: { growth: "none", growthFactor: 1, sizeMedianUsd: 5_000, sizeSigma: 1.2 },
    sim: { horizonDays: 365, stepHours: 1, paths: 200, seed: 7, poolMode: "fast", initial: deployment === "mainnet" ? "lark4" : "fresh", stateBlock: s.evmBlock },
  };
}

/** Lark 4 runs jBTC alone, Lark 0 jETH alone; the other vault is an opt-in stand-in */
export const LARK4: Params = Object.freeze(fromSnapshot("lark4", lark4)) as Params;
export const LARK0: Params = Object.freeze(fromSnapshot("lark0", lark0)) as Params;
export const MAINNET: Params = Object.freeze(fromSnapshot("mainnet", mainnet)) as Params;
export const BASELINES: Record<DeploymentKey, Params> = { mainnet: MAINNET, lark4: LARK4, lark0: LARK0 };
export const SNAPSHOTS: Record<DeploymentKey, Snapshot> = { mainnet, lark4, lark0 };
export const DEPLOYMENT_KEYS = Object.keys(BASELINES) as DeploymentKey[];

const NAMES: Record<DeploymentKey, string> = { mainnet: "Mainnet", lark4: "Lark 4", lark0: "Lark 0" };
export const DEPLOYMENT = Object.fromEntries(DEPLOYMENT_KEYS.map((k) => {
  const runs = (["eth", "btc"] as VaultKey[]).map((x) => SNAPSHOTS[k].vaults[x]).filter((x) => x.deployed);
  return [k, { name: NAMES[k], label: `${NAMES[k]} · ${runs.map((x) => `${x.name} on ${x.collateral}`).join(", ")}` }];
})) as Record<DeploymentKey, { name: string; label: string }>;

export const isDeployment = (k: unknown): k is DeploymentKey => typeof k === "string" && Object.hasOwn(BASELINES, k);
/** a deployment's settings, Lark 4's for anything unknown */
export const baseline = (k: unknown): Params => (isDeployment(k) ? BASELINES[k] : LARK4);

export function clone<T>(x: T): T {
  return structuredClone(x);
}
