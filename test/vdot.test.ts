import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { evaluateVdot, vdotParams, VDOT_DEFAULTS, VDOT_V1_DEFAULTS, VDOT_V3_DEFAULTS, VDOT_MARKET } from "../src/engine/model/vdot";
import { decodeVdot, encodeVdot } from "../src/engine/share/vdot";
import quotes from "../src/data/vdot-quotes.json";
import dotQuotes from "../src/data/vdot-dot-quotes.json";

it("matches an independent 50-digit decimal calculation at the pinned block", () => {
  const r = evaluateVdot(VDOT_V1_DEFAULTS);
  expect(r.leverage).toBeCloseTo(5, 12);
  expect(r.dotBorrowRate).toBeCloseTo(0.01784057730642373, 12);
  expect(r.vdotSupplyRate).toBeCloseTo(1.012979501372229e-7, 15);
  expect(r.carryUSD).toBeCloseTo(11052.61308387111, 7);
  expect(r.depositorUSD).toBeCloseTo(1445.5500547011688, 7);
  expect(r.protocolUSD).toBeCloseTo(10142.280348362654, 7);
  const lowerFee = evaluateVdot({ ...VDOT_V1_DEFAULTS, fee: 0.22 });
  expect(lowerFee.depositorUSD).toBeCloseTo(6640.278204120591, 7);
  expect(lowerFee.protocolUSD).toBeCloseTo(4947.552198943232, 7);
});

it("uses native vDOT/DOT growth over actual elapsed time, excluding DOT/USD", () => {
  const g = VDOT_MARKET.vdotGrowth;
  expect(g.elapsedSeconds).toBe(Number(VDOT_MARKET.timestamp) - Number(g.pastTimestamp));
  expect(VDOT_DEFAULTS.stakingApr).toBeCloseTo((Number(g.latestRate) / Number(g.pastRate) - 1) * 365 * 86400 / g.elapsedSeconds, 12);
  expect(VDOT_MARKET.crosscheck.matches).toBe(true);
  for (const r of Object.values(VDOT_MARKET.crosscheck.reserves)) expect(r).toEqual({ supplyResidual: "0", debtResidual: "0" });
});

it("matches the independent direct-DOT funding calculation with both loans in reserve utilization", () => {
  const r = evaluateVdot(VDOT_DEFAULTS);
  expect(r.assetsUSD).toBeCloseTo(841666.6666666667, 7);
  expect(r.totalDebtDOT).toBeCloseTo(916594.7992817658, 7);
  expect(r.dotBorrowRate).toBeCloseTo(0.0194509692988987, 12);
  expect(r.carryUSD).toBeCloseTo(21907.190792173853, 7);
  expect(r.mainInterestUSD).toBeCloseTo(1458.822697417405, 7);
  expect(r.loopInterestUSD).toBeCloseTo(14912.40979582236, 7);
  expect(r.depositorUSD).toBeCloseTo(5332.40644815649, 7);
  expect(r.protocolUSD).toBeCloseTo(16753.08489592394, 7);
});

it("matches DOT funding while preserving separate vault and loop liquidation risk", () => {
  const base = evaluateVdot({ ...VDOT_DEFAULTS, dotMove: 0, vdotMove: 0 });
  for (const dotMove of [-0.9, -0.5, -0.3, 0, 0.5, 2]) {
    const r = evaluateVdot({ ...VDOT_DEFAULTS, dotMove, vdotMove: 0 });
    expect(r.pricePnlUSD).toBe(0);
    expect(r.netDotExposure).toBe(0);
    expect(r.stressedSourceCoverage).toBe(1);
    expect(r.stressedHf).toBeCloseTo(VDOT_DEFAULTS.hf, 12);
    expect(r.stressedMainHf).toBeCloseTo(VDOT_DEFAULTS.mainLt / VDOT_DEFAULTS.mainLtv / (1 + dotMove), 12);
    expect(r.carryUSD).toBe(base.carryUSD);
    expect(r.feeUSD).toBe(base.feeUSD);
  }
  const down = evaluateVdot(VDOT_DEFAULTS);
  expect(down.pricePnlPerTvl).toBe(0);
  expect(down.sourceShortfallUSD).toBe(0);
  expect(down.stressedSourceCoverage).toBe(1);
  expect(down.liquidatable).toBe(false);
  const up = evaluateVdot({ ...VDOT_DEFAULTS, dotMove: 0.5 });
  expect(up.mainLiquidatable).toBe(true);
  expect(up.liquidatable).toBe(false);
  const old = evaluateVdot(VDOT_V3_DEFAULTS);
  expect(old.pricePnlPerTvl).toBeCloseTo(-0.225, 12);
  expect(old.stressedSourceCoverage).toBeCloseTo(0.7, 12);
  expect(old.depositorApr).toBeCloseTo(0.048583179979242296, 12);
});

it("a change to the oracle conversion rate hits gross assets and can liquidate the loop", () => {
  const r = evaluateVdot({ ...VDOT_DEFAULTS, dotMove: 0, vdotMove: -0.15 });
  expect(r.pricePnlUSD).toBeCloseTo(-r.assetsUSD * 0.15, 7);
  expect(r.stressedHf).toBeCloseTo(0.8585, 12);
  expect(r.liquidatable).toBe(true);
  const underwater = evaluateVdot({ ...VDOT_DEFAULTS, dotMove: 0, vdotMove: -0.5 });
  expect(underwater.stressedEquityUSD).toBeLessThan(0);
  expect(underwater.stressedSourceCoverage).toBeLessThan(0);
});

it("keeps the 85% eMode borrow limit distinct from its 92% liquidation threshold", () => {
  expect(evaluateVdot(VDOT_V1_DEFAULTS).capacityExceeded).toBe(false);
  expect(VDOT_DEFAULTS).toMatchObject({ fee: 0.69, hf: 1.01, fundingAsset: "DOT", mainDiscount: 0, mainLt: 0.85 });
  const tooHigh = evaluateVdot(VDOT_DEFAULTS);
  expect(tooHigh.capacityExceeded).toBe(true);
  expect(tooHigh.leverage).toBeCloseTo(11.22222222222222, 12);
  expect(tooHigh.debtUSD / tooHigh.assetsUSD).toBeCloseTo(0.9108910891089109, 12);
  expect(tooHigh.minimumBorrowableHf).toBeCloseTo(0.92 / 0.85, 12);
  expect(tooHigh.checks.find((c) => c.label.includes("maximum borrowing LTV"))?.ok).toBe(false);
  const normal = evaluateVdot({ ...VDOT_DEFAULTS, useEMode: false, hf: 1.25 });
  expect(normal.maxLtv).toBe(0.6);
  expect(normal.lt).toBe(0.7);
  expect(normal.minimumBorrowableHf).toBeCloseTo(0.7 / 0.6, 12);
  expect(normal.capacityExceeded).toBe(false);
});

it("accounts for aDOT route re-supply without giving its lending yield to the strategy", () => {
  const routed = evaluateVdot(VDOT_DEFAULTS);
  const direct = evaluateVdot({ ...VDOT_DEFAULTS, dotResupplyShare: 0 });
  const baseCash = Number(VDOT_MARKET.reserves.DOT.availableLiquidity) / 1e10;
  expect(routed.dotCash).toBeCloseTo(baseCash, 8);
  expect(direct.dotCash).toBeCloseTo(baseCash - direct.totalDebtDOT, 8);
  expect(routed.dotSupply - direct.dotSupply).toBeCloseTo(routed.totalDebtDOT, 8);
  expect(routed.totalDebtDOT).toBeCloseTo(routed.debtDOT + routed.mainDebtDOT, 8);
  expect(routed.dotBorrowRate).toBeLessThan(direct.dotBorrowRate);
  expect(routed.stakingIncomeUSD).toBe(direct.stakingIncomeUSD);
  expect(routed.supplyIncomeUSD).toBe(direct.supplyIncomeUSD);
  expect(routed.depositorUSD - direct.depositorUSD).toBeCloseTo((direct.loopInterestUSD - routed.loopInterestUSD) * (1 - VDOT_DEFAULTS.fee) + direct.mainInterestUSD - routed.mainInterestUSD, 8);
});

it("conserves income across depositors, protocol and DOT lenders with zero or positive fees", () => {
  for (const defaults of [VDOT_DEFAULTS, VDOT_V3_DEFAULTS]) for (const fee of [0, 0.22, 0.69, 1]) {
    const r = evaluateVdot({ ...defaults, fee });
    expect(r.stakingIncomeUSD + r.supplyIncomeUSD).toBeCloseTo(r.depositorUSD + r.protocolUSD + r.totalDotInterestUSD * 0.9, 8);
    expect(r.feeUSD).toBeCloseTo(Math.max(0, r.carryUSD) * fee, 8);
    expect(r.dotReserveIncomeUSD).toBeCloseTo(r.totalDotInterestUSD * 0.1, 8);
  }
  const loss = evaluateVdot({ ...VDOT_DEFAULTS, stakingApr: 0 });
  expect(loss.feeUSD).toBe(0);
  expect(loss.depositorApr).toBeLessThan(0);
});

it("uses manual DOT rates for interest and income while preserving reserve constraints", () => {
  const automatic = evaluateVdot(VDOT_DEFAULTS);
  expect(automatic.dotBorrowRate).toBe(automatic.dotMarketBorrowRate);
  for (const dotBorrowApr of [0, 0.03, 0.1]) {
    const r = evaluateVdot({ ...VDOT_DEFAULTS, dotBorrowApr });
    expect(r.dotBorrowRate).toBe(dotBorrowApr);
    expect(r.dotMarketBorrowRate).toBe(automatic.dotMarketBorrowRate);
    expect(r.loopInterestUSD).toBeCloseTo(r.debtUSD * dotBorrowApr, 8);
    expect(r.dotReserveIncomeUSD).toBeCloseTo(r.totalDotInterestUSD * 0.1, 8);
    expect(r.stakingIncomeUSD + r.supplyIncomeUSD).toBeCloseTo(r.depositorUSD + r.protocolUSD + r.totalDotInterestUSD * 0.9, 8);
    expect(r.checks).toEqual(automatic.checks);
    expect(r.mainInterestUSD).toBeCloseTo(r.equityUSD * dotBorrowApr, 8);
    expect(r.mainProtocolIncomeUSD).toBe(0);
    expect(r.legacy).toEqual(automatic.legacy);
    expect(r.stressedHf).toBe(automatic.stressedHf);
  }
  expect(evaluateVdot({ ...VDOT_DEFAULTS, dotBorrowApr: 0 }).depositorApr).toBeGreaterThan(automatic.depositorApr);
  const loss = evaluateVdot({ ...VDOT_DEFAULTS, dotBorrowApr: 0.1 });
  expect(loss.depositorApr).toBeLessThan(0);
  expect(loss.feeUSD).toBe(0);
});

it("flags oversized targets, preserves their notional and handles an unlevered Main", () => {
  const huge = evaluateVdot({ ...VDOT_DEFAULTS, tvl: 100_000_000 });
  expect(huge.capacityExceeded).toBe(true);
  expect(huge.equityUSD).toBe(75_000_000);
  expect(huge.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(expect.arrayContaining(["vDOT reserve supply cap", "DOT reserve borrow cap", "DOT reserve supply cap after swap re-supply", "Candidate gross exposure cap"]));
  const zero = evaluateVdot({ ...VDOT_DEFAULTS, mainLtv: 0 });
  expect(zero.depositorApr).toBe(0);
  expect(zero.stressedHf).toBeNull();
  expect(zero.stressedSourceCoverage).toBeNull();
  expect(zero.stressedMainHf).toBeNull();
  expect(zero.liquidatable).toBe(false);
});

it("preserves quote fees in output rather than charging them twice", () => {
  expect(quotes.hash).toBe(VDOT_MARKET.hash);
  const seed = quotes.quotes.find((q) => q.assetIn === 222 && q.amountIn === "75000")!;
  const outputUSD = Number(seed.quote.amountOut) * Number(VDOT_MARKET.reserves.vDOT.priceUSD8) / 1e8;
  expect(seed.costVsOracleBps).toBeCloseTo((1 - outputUSD / 75000) * 10000, 9);
  expect(seed.costVsOracleBps).toBeGreaterThan(1600);
  const dot = quotes.quotes.find((q) => q.assetIn === 5)!;
  expect(dot.quote.swaps[0]).toMatchObject({ pool: "Aave", assetIn: 5, assetOut: 1001 });
  expect(dotQuotes.hash).toBe(VDOT_MARKET.hash);
  expect(dotQuotes.quotes.every((q) => q.assetIn !== 222 && q.assetOut !== 222)).toBe(true);
  const funding = dotQuotes.quotes.find((q) => q.role === "funding")!;
  expect(Number(funding.amountIn) * Number(VDOT_MARKET.reserves.DOT.priceUSD8) / 1e8).toBeCloseTo(75000, 7);
  expect(funding.costVsOracleBps).toBeCloseTo(4.951104329987688, 10);
});

it("round-trips every assumption and rejects malformed settings", () => {
  const p = { ...VDOT_DEFAULTS, tvl: 500_000, hf: 1.3, useEMode: false, fee: 0.22, dotMove: 0.5, vdotMove: -0.1, dotBorrowApr: 0.03 };
  expect(decodeVdot(encodeVdot(p))).toEqual(p);
  expect(encodeVdot(p)).toMatch(/^vd4\./);
  expect(decodeVdot("vd1.e30")).toMatchObject({ fundingAsset: "HOLLAR", hf: 1.15, dotBorrowApr: null, mainDiscount: 0.4 });
  expect(decodeVdot("vd2.e30")).toMatchObject({ fundingAsset: "HOLLAR", hf: 1.01, dotBorrowApr: null, mainDiscount: 0.4 });
  expect(decodeVdot("vd3.e30")).toEqual(VDOT_V3_DEFAULTS);
  expect(decodeVdot("vd4.e30")).toEqual(VDOT_DEFAULTS);
  expect(decodeVdot(encodeVdot({ ...p, dotBorrowApr: 0 })).dotBorrowApr).toBe(0);
  expect(() => decodeVdot("vd5.e30")).toThrow(/version/);
  expect(() => decodeVdot("vd1.broken")).toThrow();
  for (const input of [null, [], { tvl: 0 }, { hf: 1 }, { fee: Infinity }, { fee: null }, { stakingApr: NaN }, { useEMode: "false" }, { dotMove: -1 }, { migration: 1 }, { dotBorrowApr: -0.01 }, { dotBorrowApr: 1.01 }, { dotBorrowApr: "0.03" }, { dotBorrowApr: Infinity }, { fundingAsset: "ETH" }, { mainDiscount: 0.4 }, { mainLt: 0 }]) expect(() => vdotParams(input)).toThrow();
});

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/sim.mts", ...args], { encoding: "utf8", timeout: 60_000 });

it("routes vDOT CLI links to the correct model without changing older models", () => {
  const first = cli("vdot", "--fee", "0.22", "--set", "useEMode=false", "--set", "hf=1.25", "--set", "dotBorrowApr=0.03");
  expect(first.status, first.stderr).toBe(0);
  const result = JSON.parse(first.stdout);
  const restored = cli("vdot", "--link", result.link);
  expect(restored.status, restored.stderr).toBe(0);
  expect(JSON.parse(restored.stdout)).toEqual(result);
  expect(result.result.dotBorrowRate).toBe(0.03);
  const automatic = JSON.parse(cli("vdot", "--link", result.link, "--set", "dotBorrowApr=null").stdout);
  expect(automatic.params.dotBorrowApr).toBeNull();
  expect(automatic.result.dotBorrowRate).toBe(automatic.result.dotMarketBorrowRate);
  expect(JSON.parse(cli("link", result.link).stdout).params).toEqual(result.params);
  expect(cli("mc", "--link", result.link).stderr).toContain("vDOT links need sim vdot");
  expect(cli("strategies", "--link", result.link).status).not.toBe(0);
  expect(cli("vdot", "--set", "useEMode=0").status).not.toBe(0);
  expect(cli("vdot", "--live").status).not.toBe(0);
  const url = new URL(result.link);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.set("t", "overview");
  url.hash = hash.toString();
  expect(JSON.parse(cli("link", url.toString(), "--full").stdout).params.deployment).toBe("lark4");
});
