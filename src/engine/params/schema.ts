import type { Params } from "./types";

export type Unit = "pct" | "bps" | "usd" | "x" | "days" | "hours" | "units" | "num" | "price" | "minutes";
export type Lever = "admin" | "ops" | "contract" | "market" | "model";
export type Group = "market" | "loop" | "vaults" | "pool" | "fees" | "improvements" | "flows" | "sim";

export interface ParamDef {
  path: string;
  code: string;
  group: Group;
  label: string;
  help: string;
  kind: "number" | "bool" | "enum";
  unit?: Unit;
  min?: number;
  max?: number;
  step?: number;
  log?: boolean;
  options?: { value: string; label: string }[];
  lever: Lever;
  scope: "both" | "mc";
  source?: string;
}

export const GROUPS: { key: Group; label: string }[] = [
  { key: "market", label: "Market conditions" },
  { key: "loop", label: "Leverage & loop" },
  { key: "vaults", label: "Vaults" },
  { key: "pool", label: "Pool 143 & PRIME arb" },
  { key: "fees", label: "Fees, discounts & limits" },
  { key: "improvements", label: "Improvements" },
  { key: "flows", label: "User flows" },
  { key: "sim", label: "Simulation" },
];

const n = (d: Omit<ParamDef, "kind">): ParamDef => ({ kind: "number", ...d });
const b = (d: Omit<ParamDef, "kind">): ParamDef => ({ kind: "bool", ...d });
const e = (d: Omit<ParamDef, "kind">): ParamDef => ({ kind: "enum", ...d });

const vaultDefs = (k: "eth" | "btc", tag: string, c: string): ParamDef[] => [
  n({ path: `vaults.${k}.units`, code: `${tag}u`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} deposits`, unit: "units", min: 0, max: k === "eth" ? 5000 : 200, step: k === "eth" ? 0.01 : 0.0001, log: true, lever: "market", scope: "both", help: `collateral held by the vault, in ${c}`, source: "CollateralVault.totalAssets" }),
  n({ path: `vaults.${k}.price`, code: `${tag}p`, group: "market", label: `${c} price`, unit: "usd", min: 10, max: k === "eth" ? 20000 : 300000, step: 1, log: true, lever: "market", scope: "both", help: "starting collateral price", source: "AaveOracle" }),
  n({ path: `vaults.${k}.vol`, code: `${tag}v`, group: "market", label: `${c} volatility`, unit: "pct", min: 0, max: 1.5, step: 0.005, lever: "market", scope: "both", help: "annualized volatility; drives how often the vault re-sizes its HOLLAR borrowing (rebalance churn)", source: "mainnet oracle, 1y" }),
  n({ path: `vaults.${k}.drift`, code: `${tag}d`, group: "market", label: `${c} drift`, unit: "pct", min: -1, max: 2, step: 0.01, lever: "market", scope: "both", help: "expected annual price drift (μ)" }),
  n({ path: `vaults.${k}.inKindYield`, code: `${tag}y`, group: "market", label: `${c} own yield`, unit: "pct", min: 0, max: 0.1, step: 0.001, lever: "market", scope: "both", help: "yield the collateral earns by itself (GIGAETH vs ETH ~1.5%), on top of Juicer" }),
  n({ path: `vaults.${k}.maxLtv`, code: `${tag}m`, group: "vaults", label: `${c} max LTV`, unit: "pct", min: 0.3, max: 0.9, step: 0.01, lever: "admin", scope: "both", help: "Aave max LTV of the collateral reserve; the vault's borrowing target defaults to it", source: "Aave reserve config" }),
  n({ path: `vaults.${k}.bandLo`, code: `${tag}l`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} relever below`, unit: "pct", min: 0.2, max: 0.9, step: 0.005, lever: "contract", scope: "both", help: "LTV below which the vault borrows more (price rose); today maxLtv − 5% (LTV_BAND_LOW_GAP_BPS, hardcoded)", source: "CompoundLogic" }),
  n({ path: `vaults.${k}.bandTarget`, code: `${tag}t`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} target LTV`, unit: "pct", min: 0.2, max: 0.9, step: 0.005, lever: "contract", scope: "both", help: "LTV the vault re-sizes to; today = maxLtv", source: "CompoundLogic" }),
  n({ path: `vaults.${k}.bandHi`, code: `${tag}h`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} delever above`, unit: "pct", min: 0.3, max: 0.95, step: 0.005, lever: "contract", scope: "both", help: "LTV above which the vault repays (price fell); today maxLtv + 3%", source: "CompoundLogic" }),
  b({ path: `vaults.${k}.capOn`, code: `${tag}cO`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} TVL cap on`, lever: "admin", scope: "mc", help: "deposits revert above the cap" }),
  n({ path: `vaults.${k}.tvlCap`, code: `${tag}c`, group: "vaults", label: `${tag === "e" ? "jETH" : "jBTC"} TVL cap`, unit: "units", min: 0, max: k === "eth" ? 100000 : 5000, step: k === "eth" ? 1 : 0.1, log: true, lever: "admin", scope: "mc", help: "vault tvlCap in collateral units", source: "CollateralVault.tvlCap" }),
  n({ path: `vaults.${k}.inflowUsd`, code: `${tag}i`, group: "flows", label: `${tag === "e" ? "jETH" : "jBTC"} new deposits / yr`, unit: "usd", min: 0, max: 100_000_000, step: 1000, log: true, lever: "market", scope: "both", help: "USD of new deposits per year" }),
  n({ path: `vaults.${k}.outflowRate`, code: `${tag}o`, group: "flows", label: `${tag === "e" ? "jETH" : "jBTC"} withdrawals / yr`, unit: "pct", min: 0, max: 3, step: 0.01, lever: "market", scope: "both", help: "share of TVL withdrawn per year" }),
];

export const PARAMS: ParamDef[] = [
  // market
  n({ path: "market.primeYield", code: "py", group: "market", label: "PRIME yield", unit: "pct", min: -0.05, max: 0.2, step: 0.0005, lever: "market", scope: "both", help: "PRIME's NAV growth per year (AaveOracle drift); 5.93% from 28 Sep → 20 Oct", source: "mainnet AaveOracle" }),
  n({ path: "market.hollarRate", code: "hr", group: "market", label: "HOLLAR borrow rate", unit: "pct", min: 0, max: 0.2, step: 0.0005, lever: "admin", scope: "both", help: "variable HOLLAR borrow APR; paid to the protocol (HOLLAR has no suppliers)", source: "Aave reserve" }),
  n({ path: "market.hollarMark", code: "hm", group: "market", label: "HOLLAR market price", unit: "price", min: 0.95, max: 1.01, step: 0.0001, lever: "market", scope: "both", help: "HOLLAR's traded price vs USDT; used for the market-marked hole" }),
  n({ path: "market.primePrice", code: "pp", group: "market", label: "PRIME price", unit: "price", min: 0.5, max: 2, step: 0.0001, lever: "market", scope: "both", help: "PRIME oracle price at start", source: "AaveOracle" }),
  n({ path: "market.corr", code: "co", group: "market", label: "BTC/ETH correlation", unit: "num", min: -1, max: 1, step: 0.05, lever: "market", scope: "mc", help: "correlation of the collateral price paths" }),
  e({ path: "market.pathModel", code: "pm", group: "market", label: "Price paths", options: [{ value: "gbm", label: "random (GBM)" }, { value: "historical", label: "last year replay" }, { value: "bootstrap", label: "bootstrap of last year" }], lever: "model", scope: "mc", help: "how collateral price paths are generated" }),
  e({ path: "market.stress", code: "st", group: "market", label: "Stress overlay", options: [{ value: "none", label: "none" }, { value: "v20", label: "−20% then +20%" }, { value: "crash30", label: "−30% in 48 h" }, { value: "bleed", label: "slow bleed −40%" }, { value: "oracleStep", label: "PRIME oracle −1% step" }, { value: "negCarry", label: "PRIME yield < HOLLAR rate" }, { value: "depeg", label: "HOLLAR −2% depeg" }], lever: "model", scope: "mc", help: "deterministic shock applied on top of the paths" }),
  b({ path: "market.jumps", code: "ju", group: "market", label: "Price jumps", lever: "model", scope: "mc", help: "add occasional ±8% jumps" }),
  n({ path: "market.monitorMinutes", code: "mo", group: "market", label: "Rebalance monitoring", unit: "minutes", min: 1, max: 1440, step: 1, log: true, lever: "ops", scope: "both", help: "how often price moves are seen by the rebalance check (oracle updates and keeper cadence)" }),
  // loop
  e({ path: "loop.mode", code: "lm", group: "loop", label: "Leverage set by", options: [{ value: "hf", label: "target health factor" }, { value: "lev", label: "leverage directly" }], lever: "admin", scope: "both", help: "SubLoop.setParams(targetHf, …); direct leverage is converted to the matching HF" }),
  n({ path: "loop.targetHf", code: "hf", group: "loop", label: "Target HF", unit: "num", min: 0.9, max: 3, step: 0.005, lever: "admin", scope: "both", help: "SubLoop.targetHf; leverage = 1 / (1 − LT / HF)", source: "SubLoop.targetHf" }),
  n({ path: "loop.leverage", code: "lv", group: "loop", label: "Leverage", unit: "x", min: 1, max: 9, step: 0.05, lever: "admin", scope: "both", help: "loop leverage (PRIME held per HOLLAR of principal)" }),
  n({ path: "loop.hfLag", code: "hl", group: "loop", label: "HF lag", unit: "num", min: 0, max: 0.05, step: 0.001, lever: "model", scope: "both", help: "how far the live HF sits above target (measured 1.054 vs 1.05)" }),
  n({ path: "loop.primeLt", code: "lt", group: "loop", label: "PRIME liquidation threshold", unit: "pct", min: 0.5, max: 0.95, step: 0.01, lever: "admin", scope: "both", help: "aPRIME LT in the money market", source: "Aave reserve config" }),
  n({ path: "loop.tranche", code: "tr", group: "loop", label: "Entry tranche", unit: "usd", min: 100, max: 100_000, step: 100, log: true, lever: "admin", scope: "both", help: "HOLLAR per entry order (deployTranche)", source: "SubLoop.deployTranche" }),
  n({ path: "loop.solverBps", code: "sv", group: "loop", label: "Solver cut", unit: "bps", min: 0, max: 10, step: 0.1, lever: "ops", scope: "both", help: "ICE solver haircut per intent" }),
  n({ path: "loop.laneCapBps", code: "lc", group: "loop", label: "Entry lane cap", unit: "bps", min: 1, max: 200, step: 1, lever: "admin", scope: "both", help: "max shortfall vs oracle an entry may accept; above it entries stall", source: "ExecutionController lane" }),
  n({ path: "loop.budgetCap", code: "bC", group: "loop", label: "Entry budget", unit: "usd", min: 1000, max: 10_000_000, step: 1000, log: true, lever: "admin", scope: "mc", help: "ExecutionController budget cap (refills at the rate below)" }),
  n({ path: "loop.budgetRefillPerSec", code: "br", group: "loop", label: "Budget refill / s", unit: "usd", min: 1, max: 10000, step: 1, log: true, lever: "admin", scope: "mc", help: "HOLLAR of entry budget per second" }),
  // pool & arb
  n({ path: "pool.feeBps", code: "pf", group: "pool", label: "Pool 143 fee", unit: "bps", min: 0, max: 30, step: 0.5, lever: "admin", scope: "both", help: "stableswap.updatePoolFee; the treasury is ~100% LP, so the fee comes back to it", source: "stableswap.pools(143)" }),
  n({ path: "pool.amp", code: "pa", group: "pool", label: "Pool amplification", unit: "num", min: 1, max: 2000, step: 1, log: true, lever: "admin", scope: "both", help: "stableswap amplification" }),
  n({ path: "pool.prime", code: "pr", group: "pool", label: "Pool PRIME", unit: "units", min: 1000, max: 50_000_000, step: 1000, log: true, lever: "market", scope: "both", help: "PRIME reserve of pool 143" }),
  n({ path: "pool.hollar", code: "ph", group: "pool", label: "Pool HOLLAR", unit: "units", min: 1000, max: 50_000_000, step: 1000, log: true, lever: "market", scope: "both", help: "HOLLAR reserve of pool 143" }),
  e({ path: "arb.mode", code: "am", group: "pool", label: "PRIME arb", options: [{ value: "fixed", label: "fixed thresholds" }, { value: "realistic", label: "prices its other leg" }], lever: "market", scope: "both", help: "fixed: sells PRIME at the threshold below (Lark); realistic: threshold = HOLLAR exit cost + fixed bridging + margin" }),
  n({ path: "arb.sellBps", code: "as", group: "pool", label: "Arb sells PRIME at", unit: "bps", min: 0, max: 100, step: 0.5, lever: "market", scope: "both", help: "edge over the oracle (after fee) at which arbs sell PRIME into the pool; mainnet 15", source: "lark-pins NEXT_PEG" }),
  n({ path: "arb.buyBps", code: "ab", group: "pool", label: "Arb buys PRIME at", unit: "bps", min: 0, max: 100, step: 0.5, lever: "market", scope: "both", help: "edge at which arbs buy PRIME back; mainnet 4" }),
  n({ path: "arb.exit10kBps", code: "ae", group: "pool", label: "HOLLAR exit, 10k", unit: "bps", min: 0, max: 200, step: 0.1, lever: "market", scope: "both", help: "cost to swap 10k HOLLAR to USDC (mainnet 20 Oct: 14.9)" }),
  n({ path: "arb.exit100kBps", code: "aE", group: "pool", label: "HOLLAR exit, 100k", unit: "bps", min: 0, max: 500, step: 0.1, lever: "market", scope: "both", help: "cost to swap 100k HOLLAR to USDC (mainnet 20 Oct: 52.1)" }),
  n({ path: "arb.fixedUsd", code: "af", group: "pool", label: "Arb bridge cost / cycle", unit: "usd", min: 0, max: 100, step: 0.5, lever: "market", scope: "both", help: "NTT + CCTP + mint + NTT back, per refill cycle" }),
  n({ path: "arb.tradeUsd", code: "at", group: "pool", label: "Arb cycle size", unit: "usd", min: 1000, max: 1_000_000, step: 1000, log: true, lever: "market", scope: "both", help: "size of one arb refill cycle" }),
  n({ path: "arb.marginBps", code: "aM", group: "pool", label: "Arb margin", unit: "bps", min: 0, max: 20, step: 0.1, lever: "market", scope: "both", help: "profit a realistic arb wants on top of its costs" }),
  n({ path: "arb.inventoryPrime", code: "ai", group: "pool", label: "Arb PRIME inventory", unit: "units", min: 0, max: 50_000_000, step: 1000, log: true, lever: "market", scope: "mc", help: "PRIME the arb can sell before it needs a refill" }),
  n({ path: "arb.refillHours", code: "aR", group: "pool", label: "Arb refill delay", unit: "hours", min: 0, max: 720, step: 1, lever: "market", scope: "mc", help: "hours until an empty arb is restocked (0 = never runs dry)" }),
  // costs
  e({ path: "costs.mode", code: "cm", group: "pool", label: "Trading costs", options: [{ value: "derived", label: "derived from pool & arb" }, { value: "manual", label: "manual" }], lever: "model", scope: "both", help: "derived: entry = arb band + 2·fee + impact + solver; unwind = band-dependent + 1.7·fee" }),
  n({ path: "costs.entryBps", code: "ce", group: "pool", label: "Entry cost (manual)", unit: "bps", min: 0, max: 200, step: 0.1, lever: "model", scope: "both", help: "cost of buying PRIME vs the oracle (Lark measured 24.5)" }),
  n({ path: "costs.unwindBps", code: "cu", group: "pool", label: "Unwind cost (manual)", unit: "bps", min: -30, max: 200, step: 0.1, lever: "model", scope: "both", help: "cost of selling PRIME vs the oracle on unwinds" }),
  n({ path: "costs.harvestSwapBps", code: "ch", group: "pool", label: "Harvest swap cost", unit: "bps", min: 0, max: 200, step: 1, lever: "model", scope: "both", help: "PRIME → collateral swap cost when carry compounds" }),
  // fees & limits
  n({ path: "fees.protocolFeeBps", code: "fp", group: "fees", label: "Protocol fee", unit: "bps", min: 0, max: 10_000, step: 25, lever: "admin", scope: "both", help: "JuicerFeeController.protocolFeeBps: share of the vault's yield, taken in collateral", source: "JuicerFeeController" }),
  n({ path: "fees.discountMain", code: "dm", group: "fees", label: "HOLLAR discount, vault debt", unit: "pct", min: 0, max: 1, step: 0.01, lever: "admin", scope: "both", help: "JuicerDiscount.setDiscountBps on the vaults' Main debt", source: "JuicerDiscount" }),
  n({ path: "fees.discountLoop", code: "dl", group: "fees", label: "HOLLAR discount, loop debt", unit: "pct", min: 0, max: 1, step: 0.01, lever: "contract", scope: "both", help: "needs SubLoop enrolled in the discount (v2 discount contract or SubLoop upgrade)" }),
  e({ path: "fees.feeBase", code: "fb", group: "fees", label: "Fee charged on", options: [{ value: "afterCosts", label: "yield after costs (contracts)" }, { value: "gross", label: "yield before costs (study)" }], lever: "model", scope: "both", help: "contracts take the fee on realized gains, i.e. after costs" }),
  b({ path: "depositFee.on", code: "Do", group: "fees", label: "Deposit fee", lever: "contract", scope: "both", help: "charge new deposits an entry fee" }),
  b({ path: "depositFee.auto", code: "Da", group: "fees", label: "Deposit fee = expected entry cost", lever: "contract", scope: "both", help: "auto-size the fee to entry cost × leverage × LTV (swing pricing)" }),
  n({ path: "depositFee.bps", code: "Db", group: "fees", label: "Deposit fee size", unit: "bps", min: 0, max: 500, step: 1, lever: "contract", scope: "both", help: "fee on the deposited collateral" }),
  e({ path: "depositFee.dest", code: "Dd", group: "fees", label: "Deposit fee goes to", options: [{ value: "loop", label: "the loop (existing holders)" }, { value: "protocol", label: "the protocol" }], lever: "contract", scope: "both", help: "into the loop compensates incumbents for the newcomer's entry cost" }),
  n({ path: "policy.admissionBps", code: "pA", group: "fees", label: "Admission cap", unit: "bps", min: 0, max: 2000, step: 5, lever: "admin", scope: "both", help: "deposits revert while the vault deficit exceeds this (SubLoop.admissionMaxDeficitBps)", source: "SubLoop" }),
  n({ path: "policy.stopBps", code: "pS", group: "fees", label: "Keeper deposit stop", unit: "bps", min: 0, max: 2000, step: 5, lever: "ops", scope: "both", help: "keepers set deficitStop above this vault deficit" }),
  n({ path: "policy.resumeBps", code: "pR", group: "fees", label: "Keeper deposit resume", unit: "bps", min: 0, max: 2000, step: 5, lever: "ops", scope: "mc", help: "keepers clear deficitStop below this" }),
  n({ path: "policy.cooldownHours", code: "pc", group: "fees", label: "Withdrawal cooldown", unit: "hours", min: 0, max: 720, step: 0.25, lever: "admin", scope: "mc", help: "CollateralVault.withdrawalDelay (Lark 60 s, mainnet proposal 12 h)" }),
  n({ path: "policy.harvestThresholdBps", code: "pH", group: "fees", label: "Harvest threshold", unit: "bps", min: 0, max: 500, step: 0.5, lever: "admin", scope: "mc", help: "harvest when equity exceeds principal by this" }),
  // improvements
  b({ path: "improvements.desk", code: "Id", group: "improvements", label: "Treasury PRIME desk", lever: "ops", scope: "both", help: "the treasury sells PRIME to the loop near the oracle instead of outside arbs" }),
  e({ path: "improvements.deskMode", code: "Im", group: "improvements", label: "Desk mode", options: [{ value: "peg", label: "holds pool 143 at the oracle" }, { value: "direct", label: "fills loop intents directly" }], lever: "ops", scope: "both", help: "peg: entries pay only their own pool fee; direct: no pool, only the spread" }),
  n({ path: "improvements.deskPrime", code: "Ip", group: "improvements", label: "Desk inventory", unit: "units", min: 0, max: 50_000_000, step: 1000, log: true, lever: "ops", scope: "both", help: "aPRIME the desk can sell (treasury proxies held ~886k on 20 Oct)" }),
  n({ path: "improvements.deskSpreadBps", code: "Is", group: "improvements", label: "Desk spread", unit: "bps", min: 0, max: 50, step: 0.5, lever: "ops", scope: "both", help: "premium over the oracle the desk charges" }),
  b({ path: "improvements.deskBid", code: "Ib", group: "improvements", label: "Desk buys on unwinds", lever: "ops", scope: "both", help: "the desk also buys PRIME back near the oracle when the loop sells" }),
  n({ path: "improvements.incentiveBps", code: "Ii", group: "improvements", label: "PRIME supply incentive", unit: "bps", min: 0, max: 1000, step: 5, lever: "admin", scope: "both", help: "extra APY on supplied PRIME" }),
  e({ path: "improvements.incentiveScope", code: "IS", group: "improvements", label: "Incentive scope", options: [{ value: "targeted", label: "Juicer only" }, { value: "blanket", label: "all aPRIME suppliers" }], lever: "admin", scope: "both", help: "blanket costs it on all 7.17M aPRIME" }),
  e({ path: "improvements.attribution", code: "Ia", group: "improvements", label: "Cost attribution", options: [{ value: "pooled", label: "pooled (today)" }, { value: "own", label: "each deposit pays its own" }, { value: "swing", label: "swing pricing" }], lever: "contract", scope: "both", help: "who bears a deposit's entry and an exit's unwind cost" }),
  b({ path: "improvements.matching", code: "IM", group: "improvements", label: "Match entries with unwinds", lever: "contract", scope: "mc", help: "net opposite loop flows at the oracle before touching the pool" }),
  // flows
  e({ path: "flows.growth", code: "fg", group: "flows", label: "TVL growth", options: [{ value: "none", label: "steady" }, { value: "linear", label: "linear" }, { value: "exp", label: "exponential" }], lever: "market", scope: "both", help: "shape of deposits over the horizon" }),
  n({ path: "flows.growthFactor", code: "fG", group: "flows", label: "TVL growth factor", unit: "x", min: 1, max: 100, step: 0.1, log: true, lever: "market", scope: "both", help: "end TVL / start TVL from new deposits" }),
  n({ path: "flows.sizeMedianUsd", code: "fs", group: "flows", label: "Typical deposit", unit: "usd", min: 10, max: 10_000_000, step: 10, log: true, lever: "market", scope: "mc", help: "median deposit size" }),
  // sim
  n({ path: "sim.horizonDays", code: "sh", group: "sim", label: "Horizon", unit: "days", min: 7, max: 1095, step: 1, lever: "model", scope: "both", help: "simulated period" }),
  n({ path: "sim.stepHours", code: "ss", group: "sim", label: "Time step", unit: "hours", min: 0.25, max: 24, step: 0.25, lever: "model", scope: "mc", help: "Monte Carlo step" }),
  n({ path: "sim.paths", code: "sp", group: "sim", label: "Paths", unit: "num", min: 1, max: 2000, step: 1, log: true, lever: "model", scope: "mc", help: "Monte Carlo paths" }),
  n({ path: "sim.seed", code: "sd", group: "sim", label: "Seed", unit: "num", min: 1, max: 1_000_000, step: 1, lever: "model", scope: "mc", help: "random seed (results reproduce)" }),
  e({ path: "sim.poolMode", code: "sP", group: "sim", label: "Pool math", options: [{ value: "fast", label: "fast float mirror" }, { value: "exact", label: "exact wasm" }], lever: "model", scope: "mc", help: "exact uses Hydration's stableswap wasm (slower)" }),
  e({ path: "sim.initial", code: "si", group: "sim", label: "Start from", options: [{ value: "lark4", label: "Lark 4 today" }, { value: "fresh", label: "fresh launch (ramp from zero)" }], lever: "model", scope: "mc", help: "fresh includes the initial ramp and its entry costs" }),
  ...vaultDefs("eth", "e", "GIGAETH"),
  ...vaultDefs("btc", "b", "tBTC"),
];

export const BY_PATH = new Map(PARAMS.map((p) => [p.path, p]));
export const BY_CODE = new Map(PARAMS.map((p) => [p.code, p]));

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const out = structuredClone(obj) as Record<string, unknown>;
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
  return out as T;
}

export type { Params };
