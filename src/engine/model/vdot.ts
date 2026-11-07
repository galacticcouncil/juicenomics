import market from "../../data/vdot-market.json";

export const VDOT_MARKET = market;
export const VDOT_DEFAULTS = {
  tvl: 100_000,
  mainLtv: 0.75,
  hf: 1.01,
  useEMode: true,
  fee: 0.69,
  stakingApr: market.vdotGrowth.simpleAnnualizedApr,
  mainDiscount: 0.4,
  dotResupplyShare: 1,
  grossCap: 500_000,
  netCap: 100_000,
  dotCashFloor: 1_000_000,
  dotUtilizationMax: 0.85,
  dotMove: -0.3,
  vdotMove: 0,
};
export const VDOT_V1_DEFAULTS = { ...VDOT_DEFAULTS, hf: 1.15 };
export type VdotParams = typeof VDOT_DEFAULTS;
export type VdotNumericKey = Exclude<keyof VdotParams, "useEMode">;
export const VDOT_FIELDS: { key: VdotNumericKey; label: string; unit: "$" | "%" | "×" | "DOT"; min: number; max: number; step: number; group: "Funding" | "Capacity assumptions" | "Price shock" | "Oracle stress"; help: string }[] = [
  { key: "tvl", label: "New depositor collateral", unit: "$", min: 1, max: 100_000_000, step: 1000, group: "Funding", help: "Additional TVL; Main borrows HOLLAR against the original vault collateral." },
  { key: "mainLtv", label: "Main HOLLAR LTV", unit: "%", min: 0, max: 0.8, step: 0.01, group: "Funding", help: "All of this new HOLLAR funding goes into the vDOT / DOT alternative. No existing capital is reallocated." },
  { key: "hf", label: "Loop target HF", unit: "×", min: 1.01, max: 3, step: 0.01, group: "Funding", help: "Both liquidation threshold and the maximum borrowing LTV matter. Targets below the minimum borrowable HF are flagged." },
  { key: "fee", label: "Harvest fee", unit: "%", min: 0, max: 1, step: 0.01, group: "Funding", help: "One fee on positive loop carry. Main HOLLAR interest is paid afterwards." },
  { key: "stakingApr", label: "vDOT growth APR in DOT", unit: "%", min: -0.5, max: 0.5, step: 0.001, group: "Funding", help: "Default: annualized 30-day growth of the on-chain DOT-per-vDOT exchange rate. Excludes DOT/USD moves and extra incentive rewards." },
  { key: "mainDiscount", label: "Main interest discount", unit: "%", min: 0, max: 1, step: 0.01, group: "Funding", help: "Applies to Main HOLLAR interest. DOT loop borrowing receives no discount." },
  { key: "dotResupplyShare", label: "Borrowed DOT re-supplied by swaps", unit: "%", min: 0, max: 1, step: 0.1, group: "Capacity assumptions", help: "Pinned routes wrap DOT into aDOT before buying vDOT in pool 690. This replenishes reserve cash; the aDOT belongs to the pool, so its yield is not credited to this strategy. Use 0% to test swaps without re-supply." },
  { key: "grossCap", label: "Candidate gross asset cap", unit: "$", min: 0, max: 1_000_000_000, step: 10_000, group: "Capacity assumptions", help: "A modeling limit on the additional vDOT position, not a deployed strategy parameter." },
  { key: "netCap", label: "Candidate net funding cap", unit: "$", min: 0, max: 100_000_000, step: 10_000, group: "Capacity assumptions", help: "A modeling limit on HOLLAR assigned to this strategy." },
  { key: "dotCashFloor", label: "DOT reserve cash to retain", unit: "DOT", min: 0, max: 100_000_000, step: 100_000, group: "Capacity assumptions", help: "Remaining reserve cash after borrowing and swap-route re-supply. Entry still needs cash for each borrow tranche." },
  { key: "dotUtilizationMax", label: "DOT utilization ceiling", unit: "%", min: 0, max: 1, step: 0.01, group: "Capacity assumptions", help: "Defaults to the rate curve's 85% kink. Rates rise rapidly above it." },
  { key: "dotMove", label: "DOT / USD price move", unit: "%", min: -0.9, max: 2, step: 0.05, group: "Price shock", help: "Instantaneous move in both vDOT and DOT dollar prices. Original vault collateral stays fixed; this measures source exposure only." },
  { key: "vdotMove", label: "Oracle conversion-rate change", unit: "%", min: -0.5, max: 0.5, step: 0.01, group: "Oracle stress", help: "Stress the Bifrost DOT-per-vDOT conversion-rate feed itself. A market trading discount does not change this feed or loop HF; it affects execution value." },
];

export function vdotParams(input: unknown, defaults: VdotParams = VDOT_DEFAULTS): VdotParams {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("vDOT settings must be an object");
  const values = input as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (key !== "useEMode" && !VDOT_FIELDS.some((f) => f.key === key)) throw new Error(`unknown vDOT setting: ${key}`);
  }
  const p = { ...defaults, ...values };
  if (typeof p.useEMode !== "boolean") throw new Error("useEMode must be true or false");
  for (const f of VDOT_FIELDS) {
    const value = p[f.key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < f.min || value > f.max) throw new Error(`${f.key} must be between ${f.min} and ${f.max}`);
  }
  return p;
}

function rate(u: number, curve: typeof market.curves.DOT) {
  const usage = Math.min(1, Math.max(0, u));
  const optimal = Number(curve.optimal) / 1e27;
  return Number(curve.base) / 1e27 + (usage <= optimal
    ? Number(curve.slope1) / 1e27 * usage / optimal
    : Number(curve.slope1) / 1e27 + Number(curve.slope2) / 1e27 * (usage - optimal) / (1 - optimal));
}

export function evaluateVdot(input: VdotParams) {
  const p = vdotParams(input);
  const v = market.reserves.vDOT, d = market.reserves.DOT, prime = market.reserves.PRIME;
  const lt = (p.useEMode ? market.eMode.liquidationThreshold : Number(v.ltBps)) / 1e4;
  const maxLtv = (p.useEMode ? market.eMode.ltv : Number(v.ltvBps)) / 1e4;
  const leverage = p.hf / (p.hf - lt);
  const equityUSD = p.tvl * p.mainLtv;
  const assetsUSD = equityUSD * leverage;
  const debtUSD = assetsUSD - equityUSD;
  const dotPrice = Number(d.priceUSD8) / 1e8, vdotPrice = Number(v.priceUSD8) / 1e8;
  const debtDOT = debtUSD / dotPrice, assetsVdot = assetsUSD / vdotPrice;
  const dotResupply = debtDOT * p.dotResupplyShare;
  const dotBaseCash = Number(d.availableLiquidity) / 10 ** d.decimals;
  const dotCash = dotBaseCash - debtDOT + dotResupply;
  const dotDebt = (Number(d.variableDebt) + Number(d.stableDebt)) / 10 ** d.decimals + debtDOT;
  const dotSupply = Number(d.supply) / 10 ** d.decimals + dotResupply;
  const dotUtilization = dotDebt / (dotCash + dotDebt);
  const dotBorrowRate = rate(dotUtilization, market.curves.DOT);
  const vdotDebt = (Number(v.variableDebt) + Number(v.stableDebt)) / 10 ** v.decimals;
  const vdotSupply = Number(v.supply) / 10 ** v.decimals + assetsVdot;
  const vdotUtilization = vdotDebt / (Number(v.availableLiquidity) / 10 ** v.decimals + assetsVdot + vdotDebt);
  const vdotSupplyRate = rate(vdotUtilization, market.curves.vDOT) * vdotUtilization * (1 - Number(v.reserveFactorBps) / 1e4);
  const stakingIncomeUSD = assetsUSD * p.stakingApr;
  const supplyIncomeUSD = assetsUSD * vdotSupplyRate;
  const loopInterestUSD = debtUSD * dotBorrowRate;
  const carryUSD = stakingIncomeUSD + supplyIncomeUSD - loopInterestUSD;
  const feeUSD = Math.max(0, carryUSD) * p.fee;
  const mainInterestUSD = equityUSD * Number(market.reserves.HOLLAR.borrowRateRay) / 1e27 * (1 - p.mainDiscount);
  const depositorUSD = carryUSD - feeUSD - mainInterestUSD;
  const dotReserveIncomeUSD = loopInterestUSD * Number(d.reserveFactorBps) / 1e4;
  const protocolUSD = feeUSD + mainInterestUSD + dotReserveIncomeUSD;
  const depositorApr = depositorUSD / p.tvl;
  const stressedAssetsUSD = assetsUSD * (1 + p.dotMove) * (1 + p.vdotMove);
  const stressedDebtUSD = debtUSD * (1 + p.dotMove);
  const stressedEquityUSD = stressedAssetsUSD - stressedDebtUSD;
  const pricePnlUSD = stressedEquityUSD - equityUSD;
  const stressedHf = debtUSD > 0 ? stressedAssetsUSD * lt / stressedDebtUSD : null;
  const poolVdot = Number(market.pool690.balances[15]) / 10 ** v.decimals;
  const active = equityUSD > 0;
  const checks = [
    { label: "vDOT collateral active, unfrozen and unpaused", ok: v.active === "1" && v.frozen === "0" && v.paused === "0" && maxLtv > 0 },
    { label: "DOT borrowing active, unfrozen and unpaused", ok: d.active === "1" && d.frozen === "0" && d.paused === "0" && d.borrowing === "1" },
    { label: "Matching DOT eMode and supported price source", ok: !p.useEMode || (v.eMode !== "0" && v.eMode === d.eMode && market.eMode.priceSource === "0x0000000000000000000000000000000000000000") },
    { label: "No isolation restriction on vDOT", ok: v.isolationCeilingUSD2 === "0" },
    { label: "Target fits the maximum borrowing LTV", ok: !active || debtUSD / assetsUSD <= maxLtv + 1e-12 },
    { label: "vDOT reserve supply cap", ok: !active || v.supplyCap === "0" || vdotSupply <= Number(v.supplyCap) },
    { label: "DOT reserve borrow cap", ok: !active || d.borrowCap === "0" || dotDebt <= Number(d.borrowCap) },
    { label: "DOT reserve supply cap after swap re-supply", ok: !active || d.supplyCap === "0" || dotSupply <= Number(d.supplyCap) },
    { label: "DOT cash buffer and cash for a first borrow", ok: !active || (dotCash >= p.dotCashFloor && dotBaseCash > 0) },
    { label: "DOT utilization ceiling", ok: !active || dotUtilization <= p.dotUtilizationMax },
    { label: "Candidate gross exposure cap", ok: assetsUSD <= p.grossCap },
    { label: "Candidate net funding cap", ok: equityUSD <= p.netCap },
    { label: "Target below pool 690's entire vDOT inventory", ok: assetsVdot < poolVdot },
    { label: "DOT oracle and vDOT rate updated within 1 hour", ok: Number(d.round.ageSeconds) >= 0 && Number(d.round.ageSeconds) <= 3600 && Number(market.vdotGrowth.feedAgeSeconds) >= 0 && Number(market.vdotGrowth.feedAgeSeconds) <= 3600 },
  ];
  const legacyLeverage = 1.05 / (1.05 - Number(prime.ltBps) / 1e4);
  const legacyAssets = equityUSD * legacyLeverage;
  const legacyDebt = legacyAssets - equityUSD;
  const primeUnits = legacyAssets / (Number(prime.priceUSD8) / 1e8);
  const primeReserveDebt = (Number(prime.variableDebt) + Number(prime.stableDebt)) / 10 ** prime.decimals;
  const primeUtilization = primeReserveDebt / (Number(prime.availableLiquidity) / 10 ** prime.decimals + primeUnits + primeReserveDebt);
  const primeSupplyRate = rate(primeUtilization, market.curves.PRIME) * primeUtilization * (1 - Number(prime.reserveFactorBps) / 1e4);
  const legacyInterest = (legacyDebt - Math.min(legacyDebt, 5_000_000) * 0.9) * Number(market.reserves.HOLLAR.borrowRateRay) / 1e27;
  const legacyCarry = legacyAssets * (0.062 + primeSupplyRate) - legacyInterest;
  const legacyFee = Math.max(0, legacyCarry) * p.fee;
  return {
    leverage, lt, maxLtv, minimumBorrowableHf: lt / maxLtv, equityUSD, assetsUSD, debtUSD, debtDOT, assetsVdot,
    dotResupply, dotCash, dotDebt, dotSupply, dotUtilization, dotBorrowRate, vdotSupply, vdotSupplyRate,
    stakingIncomeUSD, supplyIncomeUSD, loopInterestUSD, carryUSD, feeUSD, mainInterestUSD,
    depositorUSD, depositorApr, depositorMonthlyApy: (1 + depositorApr / 12) ** 12 - 1,
    dotReserveIncomeUSD, protocolUSD, protocolIncomePerTvl: protocolUSD / p.tvl,
    breakEvenFee: carryUSD > 0 ? 1 - mainInterestUSD / carryUSD : null,
    netDotExposure: equityUSD / dotPrice,
    stressedAssetsUSD, stressedDebtUSD, stressedEquityUSD, pricePnlUSD, pricePnlPerTvl: pricePnlUSD / p.tvl,
    stressedHf, stressedSourceCoverage: active ? stressedEquityUSD / equityUSD : null,
    sourceShortfallUSD: Math.max(0, equityUSD - stressedEquityUSD),
    liquidatable: stressedHf !== null && stressedHf < 1,
    poolVdot, checks, capacityExceeded: checks.some((x) => !x.ok),
    legacy: { depositorApr: (legacyCarry - legacyFee - mainInterestUSD) / p.tvl,
      protocolIncomePerTvl: (legacyFee + mainInterestUSD + legacyInterest) / p.tvl,
      hollarDebt: equityUSD + legacyDebt, leverage: legacyLeverage },
  };
}

export const VDOT_SCOPE = "Alternative source for marginal new HOLLAR funding. Steady-state carry at flat DOT/USD, separate instantaneous price shocks, no active capital reallocation. Excludes entry/exit fees, gas, ramp, churn, incentives and keeper response. Router quotes are pinned one-shot observations, not a full-ramp execution simulation. Original vault collateral is held fixed in price shocks. Positive source P&L is unrealized and shown before any harvesting fee.";
