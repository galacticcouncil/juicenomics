import market from "../../data/two-strategy-market.json";

export const STRATEGY_MARKET = market;
export const STRATEGY_DEFAULTS = {
  tvl: 100_000,
  weight: 0,
  fee: 0.69,
  mainLtv: 0.75,
  legacyHf: 1.05,
  apyHf: 1.3,
  primeGrowth: 0.062,
  apyGrowth: 0.1297,
  hollarRate: Number(market.reserves.HOLLAR.borrowRateRay) / 1e27,
  mainDiscount: 0.4,
  loopDiscount: 0.9,
  loopDiscountCap: 5_000_000,
  legacyGrossCap: 500_000,
  apyGrossCap: 500_000,
  legacyNetCap: 100_000,
  apyNetCap: 100_000,
  primeCashFloor: 1_000_000,
  primeUtilizationMax: 0.75,
};

export type StrategyParams = typeof STRATEGY_DEFAULTS;
export type StrategyKey = keyof StrategyParams;
export interface StrategyField {
  key: StrategyKey;
  label: string;
  group: "Funding" | "Carry assumptions" | "Capacity limits";
  unit: "$" | "%" | "×" | "PRIME";
  min: number;
  max: number;
  step: number;
  help: string;
}

export const STRATEGY_FIELDS: StrategyField[] = [
  { key: "tvl", label: "New depositor collateral", group: "Funding", unit: "$", min: 1, max: 100_000_000, step: 1000, help: "Additional TVL above the pinned market. Existing positions are not moved or counted again." },
  { key: "weight", label: "apyUSD allocation", group: "Funding", unit: "%", min: 0, max: 1, step: 0.01, help: "Share of new HOLLAR funding allocated to apyUSD / PRIME at full ramp. The rest goes to PRIME / HOLLAR. No active reallocation." },
  { key: "fee", label: "Blended harvest fee", group: "Funding", unit: "%", min: 0, max: 1, step: 0.01, help: "One fee on positive aggregate carry after both strategies' debt costs. Main interest is paid afterwards." },
  { key: "mainLtv", label: "Main HOLLAR LTV", group: "Funding", unit: "%", min: 0, max: 0.8, step: 0.01, help: "Main continues to borrow HOLLAR. This is a target, not a simulation of collateral price bands." },
  { key: "legacyHf", label: "PRIME / HOLLAR HF", group: "Funding", unit: "×", min: 1.01, max: 3, step: 0.01, help: "PRIME liquidation threshold is pinned at 88%. Leverage = HF / (HF − threshold)." },
  { key: "apyHf", label: "apyUSD / PRIME HF", group: "Funding", unit: "×", min: 1.01, max: 3, step: 0.01, help: "apyUSD liquidation threshold is pinned at 88%. The loop holds apyUSD and owes appreciating PRIME." },
  { key: "primeGrowth", label: "PRIME native growth APR", group: "Carry assumptions", unit: "%", min: -0.5, max: 0.5, step: 0.001, help: "Historical assumption, not a fresh yield quote. Adds to PRIME asset income and to the USD cost of PRIME debt." },
  { key: "apyGrowth", label: "apyUSD native growth APR", group: "Carry assumptions", unit: "%", min: -0.5, max: 0.5, step: 0.001, help: "Historical 12.97% APR assumption. Positive allocations assume a working oracle; the pinned oracle is stale." },
  { key: "hollarRate", label: "HOLLAR borrow APR", group: "Carry assumptions", unit: "%", min: 0, max: 1, step: 0.001, help: "Pinned base rate, before the separate Main and legacy loop discounts." },
  { key: "mainDiscount", label: "Main interest discount", group: "Carry assumptions", unit: "%", min: 0, max: 1, step: 0.01, help: "Discount on Main HOLLAR interest, regardless of the strategy split." },
  { key: "loopDiscount", label: "Legacy loop discount", group: "Carry assumptions", unit: "%", min: 0, max: 1, step: 0.01, help: "Applies only to HOLLAR loop interest up to the discount cap. PRIME debt receives no discount." },
  { key: "loopDiscountCap", label: "Legacy discount debt cap", group: "Carry assumptions", unit: "$", min: 0, max: 100_000_000, step: 100_000, help: "Debt above this cap pays the full HOLLAR rate. The preview treats the marginal position as a new source with this allowance available." },
  { key: "legacyGrossCap", label: "PRIME gross asset cap", group: "Capacity limits", unit: "$", min: 0, max: 1_000_000_000, step: 10_000, help: "Candidate limit on this additional strategy position, not an observed deployed cap." },
  { key: "apyGrossCap", label: "apyUSD gross asset cap", group: "Capacity limits", unit: "$", min: 0, max: 1_000_000_000, step: 10_000, help: "Candidate limit on this additional strategy position, not an observed deployed cap." },
  { key: "legacyNetCap", label: "PRIME net funding cap", group: "Capacity limits", unit: "$", min: 0, max: 100_000_000, step: 10_000, help: "Cap on net HOLLAR funding assigned to the legacy strategy." },
  { key: "apyNetCap", label: "apyUSD net funding cap", group: "Capacity limits", unit: "$", min: 0, max: 100_000_000, step: 10_000, help: "Cap on net HOLLAR funding assigned to the apyUSD strategy." },
  { key: "primeCashFloor", label: "PRIME cash to retain", group: "Capacity limits", unit: "PRIME", min: 0, max: 100_000_000, step: 100_000, help: "Reserve cash remaining after the new legacy supply and apyUSD borrowing." },
  { key: "primeUtilizationMax", label: "PRIME utilization ceiling", group: "Capacity limits", unit: "%", min: 0, max: 1, step: 0.01, help: "Candidate limit; defaults to the rate curve's 75% kink." },
];

export function strategyParams(input: unknown): StrategyParams {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("strategy settings must be an object");
  const values = input as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!STRATEGY_FIELDS.some((d) => d.key === key)) throw new Error(`unknown strategy setting: ${key}`);
  }
  const p = { ...STRATEGY_DEFAULTS, ...values };
  for (const d of STRATEGY_FIELDS) {
    const v = p[d.key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < d.min || v > d.max) {
      throw new Error(`${d.key} must be between ${d.min} and ${d.max}`);
    }
  }
  return p;
}

export function primeRate(utilization: number): number {
  const c = market.primeRateCurve;
  const u = Math.min(1, Math.max(0, utilization));
  const optimal = Number(c.optimal) / 1e27;
  return Number(c.base) / 1e27 + (u <= optimal
    ? Number(c.slope1) / 1e27 * u / optimal
    : Number(c.slope1) / 1e27 + Number(c.slope2) / 1e27 * (u - optimal) / (1 - optimal));
}

export function evaluateStrategies(input: StrategyParams) {
  const p = strategyParams(input);
  const prime = market.reserves.PRIME, apy = market.reserves.apyUSD;
  const leverage = [p.legacyHf / (p.legacyHf - Number(prime.ltBps) / 1e4), p.apyHf / (p.apyHf - Number(apy.ltBps) / 1e4)];
  const mainDebtHollar = p.tvl * p.mainLtv;
  const equity = [mainDebtHollar * (1 - p.weight), mainDebtHollar * p.weight];
  const grossAssetsUSD = equity.map((e, i) => e * leverage[i]);
  const debtUSD = grossAssetsUSD.map((g, i) => g - equity[i]);
  const primePrice = Number(prime.priceUSD8) / 1e8;
  const extraPrimeSupply = grossAssetsUSD[0] / primePrice;
  const extraPrimeDebt = debtUSD[1] / primePrice;
  const primeSupply = Number(prime.supply) / 10 ** prime.decimals + extraPrimeSupply;
  const primeDebt = (Number(prime.variableDebt) + Number(prime.stableDebt)) / 10 ** prime.decimals + extraPrimeDebt;
  const primeCash = Number(prime.availableLiquidity) / 10 ** prime.decimals + extraPrimeSupply - extraPrimeDebt;
  const utilization = primeDebt / (primeCash + primeDebt);
  const primeBorrowRate = primeRate(utilization);
  const reserveFactor = Number(prime.reserveFactorBps) / 1e4;
  const primeSupplyRate = primeBorrowRate * Math.min(1, utilization) * (1 - reserveFactor);
  const grossIncomeUSD = [grossAssetsUSD[0] * (p.primeGrowth + primeSupplyRate), grossAssetsUSD[1] * (p.apyGrowth + Number(apy.liquidityRateRay) / 1e27)];
  const primeDebtDriftUSD = debtUSD[1] * p.primeGrowth;
  const primeDebtInterestUSD = debtUSD[1] * primeBorrowRate;
  const debtCostUSD = [p.hollarRate * (debtUSD[0] - Math.min(debtUSD[0], p.loopDiscountCap) * p.loopDiscount), primeDebtDriftUSD + primeDebtInterestUSD];
  const carryUSD = grossIncomeUSD.map((g, i) => g - debtCostUSD[i]);
  const totalCarryUSD = carryUSD[0] + carryUSD[1];
  const protocolFeeUSD = Math.max(0, totalCarryUSD) * p.fee;
  const mainCostUSD = mainDebtHollar * p.hollarRate * (1 - p.mainDiscount);
  const depositorUSD = totalCarryUSD - protocolFeeUSD - mainCostUSD;
  const primeReserveIncomeUSD = primeDebtInterestUSD * reserveFactor;
  const protocolUSD = protocolFeeUSD + mainCostUSD + debtCostUSD[0] + primeReserveIncomeUSD;
  const depositorApr = depositorUSD / p.tvl;
  const apyTokensAtCurrentOracle = grossAssetsUSD[1] / (Number(apy.priceUSD8) / 1e8);
  const activeApy = equity[1] > 0;
  const activeLegacy = equity[0] > 0;
  const capacity = [
    { label: "PRIME strategy gross cap", ok: grossAssetsUSD[0] <= p.legacyGrossCap },
    { label: "apyUSD strategy gross cap", ok: grossAssetsUSD[1] <= p.apyGrossCap },
    { label: "PRIME strategy net cap", ok: equity[0] <= p.legacyNetCap },
    { label: "apyUSD strategy net cap", ok: equity[1] <= p.apyNetCap },
    { label: "PRIME reserve borrow cap", ok: !activeApy || Number(prime.borrowCap) === 0 || primeDebt <= Number(prime.borrowCap) },
    { label: "PRIME cash buffer", ok: !activeApy || primeCash >= p.primeCashFloor },
    { label: "PRIME utilization ceiling", ok: !activeApy || utilization <= p.primeUtilizationMax },
    { label: "PRIME reserve supply cap", ok: !activeLegacy || Number(prime.supplyCap) === 0 || primeSupply <= Number(prime.supplyCap) },
    { label: "apyUSD reserve supply cap", ok: !activeApy || Number(apy.supplyCap) === 0 || Number(apy.supply) / 10 ** apy.decimals + apyTokensAtCurrentOracle <= Number(apy.supplyCap) },
    { label: "Legacy isolation ceiling", ok: !activeLegacy || Number(prime.isolationCeilingUSD2) === 0 || Number(prime.isolationDebtUSD2) / 100 + debtUSD[0] <= Number(prime.isolationCeilingUSD2) / 100 },
  ];
  const prerequisites = [
    { label: "Fresh apyUSD oracle (within 1 hour)", ok: Number(apy.round.ageSeconds) <= 3600 },
    { label: "PRIME borrowing allowed in isolation", ok: prime.borrowableInIsolation === "1" },
    { label: "apyUSD isolation headroom", ok: Number(apy.isolationDebtUSD2) < Number(apy.isolationCeilingUSD2) },
  ];
  return {
    mainDebtHollar, leverage, equity, grossAssetsUSD, debtUSD, extraPrimeSupply, extraPrimeDebt,
    primeSupply, primeDebt, primeCash, utilization, primeBorrowRate, primeSupplyRate,
    grossIncomeUSD, debtCostUSD, carryUSD, totalCarryUSD, primeDebtDriftUSD, primeDebtInterestUSD,
    protocolFeeUSD, mainCostUSD, primeReserveIncomeUSD, depositorUSD, protocolUSD, depositorApr,
    depositorMonthlyApy: (1 + depositorApr / 12) ** 12 - 1,
    protocolRevenuePerTvl: protocolUSD / p.tvl,
    hollarDebtUSD: mainDebtHollar + debtUSD[0],
    apyTokensAtCurrentOracle, capacity, prerequisites,
    apyBlocked: activeApy && prerequisites.some((x) => !x.ok),
    capacityExceeded: capacity.some((x) => !x.ok),
    pool146Apy: Number(market.pools[146].balances[46]) / 10 ** apy.decimals,
    liquidationDrop: [1 - 1 / p.legacyHf, 1 - 1 / p.apyHf],
  };
}

export const STRATEGY_SCOPE = "Marginal new TVL at full ramp; Main borrows HOLLAR. Hypothetical carry with no active reallocation. Entry/exit execution, pool refill, gas, churn, oracle impairment, time-varying rates and native depositor collateral yield are excluded. Capacity failures do not clip the requested target. The pool-143 Monte Carlo does not model this scenario.";
