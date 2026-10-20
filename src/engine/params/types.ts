export type VaultKey = "eth" | "btc";

export interface VaultParams {
  name: string;
  collateral: string;
  units: number;
  price: number;
  vol: number;
  drift: number;
  inKindYield: number;
  maxLtv: number;
  lt: number;
  bandLo: number;
  bandTarget: number;
  bandHi: number;
  capOn: boolean;
  tvlCap: number;
  inflowUsd: number;
  outflowRate: number;
  mainDebt: number;
  loopPrincipal: number;
  loopEquityUsd: number;
}

export type PathModel = "gbm" | "historical" | "bootstrap";
export type Stress = "none" | "v20" | "crash30" | "bleed" | "oracleStep" | "negCarry";

export interface Params {
  v: 1;
  market: {
    primeYield: number;
    primePrice: number;
    hollarRate: number;
    hollarMark: number;
    corr: number;
    pathModel: PathModel;
    stress: Stress;
    stressDay: number;
    jumps: boolean;
    monitorMinutes: number;
  };
  loop: {
    mode: "hf" | "lev";
    targetHf: number;
    leverage: number;
    hfLag: number;
    primeLt: number;
    tranche: number;
    solverBps: number;
    laneCapBps: number;
    budgetCap: number;
    budgetRefillPerSec: number;
    collateralUsd: number;
    debtUsd: number;
  };
  vaults: Record<VaultKey, VaultParams>;
  pool: {
    prime: number;
    hollar: number;
    amp: number;
    feeBps: number;
  };
  arb: {
    mode: "fixed" | "realistic";
    sellBps: number;
    buyBps: number;
    exit10kBps: number;
    exit100kBps: number;
    fixedUsd: number;
    tradeUsd: number;
    marginBps: number;
    inventoryPrime: number;
    inventoryHollar: number;
    refillHours: number;
  };
  costs: {
    mode: "derived" | "manual";
    entryBps: number;
    unwindBps: number;
    harvestSwapBps: number;
    churnModel: "pool" | "constant";
  };
  fees: {
    protocolFeeBps: number;
    discountMain: number;
    discountLoop: number;
    feeBase: "contract" | "yield" | "gross";
  };
  depositFee: {
    on: boolean;
    auto: boolean;
    bps: number;
    dest: "protocol" | "loop";
  };
  improvements: {
    desk: boolean;
    deskMode: "peg" | "direct";
    deskPrime: number;
    deskSpreadBps: number;
    deskBid: boolean;
    incentiveBps: number;
    incentiveScope: "targeted" | "blanket";
    blanketPrime: number;
    attribution: "pooled" | "own" | "swing";
    matching: boolean;
  };
  policy: {
    admissionBps: number;
    stopBps: number;
    resumeBps: number;
    cooldownHours: number;
    harvestThresholdBps: number;
    costReserveBps: number;
  };
  flows: {
    growth: "none" | "linear" | "exp";
    growthFactor: number;
    sizeMedianUsd: number;
    sizeSigma: number;
  };
  sim: {
    horizonDays: number;
    stepHours: number;
    paths: number;
    seed: number;
    poolMode: "fast" | "exact";
    initial: "lark4" | "fresh";
    stateBlock: number;
  };
}
