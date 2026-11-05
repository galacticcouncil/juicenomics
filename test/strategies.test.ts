import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import fixture from "./fixtures/two-strategy-economics.json";
import { evaluateStrategies, primeRate, strategyParams, STRATEGY_DEFAULTS, STRATEGY_MARKET } from "../src/engine/model/twoStrategy";
import { decodeStrategies, encodeStrategies } from "../src/engine/share/strategies";

it("reproduces the independently pinned November 5 carry study", () => {
  for (const reference of fixture.scenarios) {
    const r = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: reference.weight });
    for (const key of ["depositorApr", "depositorMonthlyApy", "protocolRevenuePerTvl", "primeBorrowRate", "primeSupplyRate", "primeCash", "protocolFeeUSD", "mainCostUSD"] as const) {
      expect(r[key], `${reference.weight}: ${key}`).toBeCloseTo(reference[key], 10);
    }
    for (const key of ["equity", "grossAssetsUSD", "debtUSD", "carryUSD"] as const) {
      r[key].forEach((value, i) => expect(value).toBeCloseTo(reference[key][i], 8));
    }
  }
});

it("keeps Main in HOLLAR for every weight and charges one aggregate fee", () => {
  for (const weight of [0, 0.25, 0.5, 1]) for (const fee of [0, 0.22, 0.69, 1]) {
    const r = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight, fee });
    expect(r.mainDebtHollar).toBe(75_000);
    expect(r.equity[0] + r.equity[1]).toBe(75_000);
    expect(r.protocolFeeUSD).toBeCloseTo(Math.max(0, r.carryUSD[0] + r.carryUSD[1]) * fee, 9);
    expect(r.depositorUSD + r.protocolFeeUSD + r.mainCostUSD).toBeCloseTo(r.totalCarryUSD, 9);
    expect(r.protocolUSD).toBeCloseTo(r.protocolFeeUSD + r.mainCostUSD + r.debtCostUSD[0] + r.primeReserveIncomeUSD, 9);
  }
});

it("offsets one strategy's loss before charging the fee and never charges on negative carry", () => {
  const mixed = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: 0.5, apyGrowth: 0 });
  expect(mixed.carryUSD[1]).toBeLessThan(0);
  expect(mixed.totalCarryUSD).toBeGreaterThan(0);
  expect(mixed.protocolFeeUSD).toBeLessThan(mixed.carryUSD[0] * STRATEGY_DEFAULTS.fee);
  const loss = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: 1, apyGrowth: 0 });
  expect(loss.protocolFeeUSD).toBe(0);
  expect(loss.depositorApr).toBeLessThan(0);
});

it("prices PRIME debt in token units and excludes its appreciation from protocol revenue", () => {
  const r = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: 1 });
  expect(r.extraPrimeDebt).toBeCloseTo(r.debtUSD[1] / (Number(STRATEGY_MARKET.reserves.PRIME.priceUSD8) / 1e8), 8);
  expect(r.debtCostUSD[1]).toBeCloseTo(r.debtUSD[1] * (STRATEGY_DEFAULTS.primeGrowth + r.primeBorrowRate), 8);
  expect(r.primeReserveIncomeUSD).toBeCloseTo(r.primeDebtInterestUSD * 0.2, 9);
  expect(r.primeDebtDriftUSD).toBeGreaterThan(r.primeDebtInterestUSD);
});

it("uses the kinked PRIME curve and responds to both supply and borrowing", () => {
  expect(primeRate(0)).toBe(0);
  expect(primeRate(0.75)).toBeCloseTo(0.02, 12);
  expect(primeRate(1)).toBeCloseTo(0.22, 12);
  expect(primeRate(1.5)).toBe(primeRate(1));
  const before = Number(STRATEGY_MARKET.reserves.PRIME.availableLiquidity) / 1e6;
  const legacy = evaluateStrategies(STRATEGY_DEFAULTS);
  const apy = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: 1 });
  expect(legacy.primeCash - before).toBeCloseTo(legacy.extraPrimeSupply, 8);
  expect(before - apy.primeCash).toBeCloseTo(apy.extraPrimeDebt, 8);
  expect(apy.primeBorrowRate).toBeGreaterThan(legacy.primeBorrowRate);
});

it("keeps positive allocations blocked and marks oversized targets without silently clipping them", () => {
  expect(STRATEGY_DEFAULTS.weight).toBe(0);
  const legacy = evaluateStrategies(STRATEGY_DEFAULTS);
  expect(legacy.apyBlocked).toBe(false);
  expect(legacy.capacityExceeded).toBe(false);
  const mixed = evaluateStrategies({ ...STRATEGY_DEFAULTS, weight: 0.25 });
  expect(mixed.apyBlocked).toBe(true);
  expect(mixed.prerequisites.filter((x) => !x.ok)).toHaveLength(3);
  const huge = evaluateStrategies({ ...STRATEGY_DEFAULTS, tvl: 100_000_000, weight: 1 });
  expect(huge.capacityExceeded).toBe(true);
  expect(huge.equity[1]).toBe(75_000_000);
  expect(huge.primeCash).toBeLessThan(0);
  expect(huge.capacity.filter((x) => !x.ok).map((x) => x.label)).toEqual(expect.arrayContaining(["PRIME reserve borrow cap", "PRIME cash buffer", "apyUSD strategy net cap"]));
});

it("charges the full HOLLAR rate above the legacy discount debt cap", () => {
  const p = { ...STRATEGY_DEFAULTS, tvl: 2_000_000 };
  const r = evaluateStrategies(p);
  expect(r.debtUSD[0]).toBeGreaterThan(p.loopDiscountCap);
  expect(r.debtCostUSD[0]).toBeCloseTo((r.debtUSD[0] - p.loopDiscountCap * p.loopDiscount) * p.hollarRate, 7);
});

it("round-trips every strategy setting and rejects malformed or out-of-range links", () => {
  const p = { ...STRATEGY_DEFAULTS, weight: 0.37, fee: 0.22, apyHf: 1.47, tvl: 1_234_567, primeCashFloor: 800_000 };
  expect(decodeStrategies(encodeStrategies(p))).toEqual(p);
  expect(() => decodeStrategies("2.e30")).toThrow(/version/);
  expect(() => decodeStrategies("1.broken")).toThrow();
  for (const invalid of [{ weight: 1.1 }, { fee: -1 }, { tvl: 0 }, { tvl: Infinity }, { legacyHf: NaN }, { apyHf: 1 }, { migration: 1 }, []]) {
    expect(() => strategyParams(invalid)).toThrow();
  }
});

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/sim.mts", ...args], { encoding: "utf8", timeout: 60_000 });

it("the CLI and its share link reproduce the same strategy result", () => {
  const call = cli("strategies", "--weight", "0.25", "--fee", "0.22", "--set", "apyHf=1.4");
  expect(call.status, call.stderr).toBe(0);
  const first = JSON.parse(call.stdout);
  const back = cli("strategies", "--link", first.link);
  expect(back.status, back.stderr).toBe(0);
  expect(JSON.parse(back.stdout)).toEqual(first);
  const decoded = cli("link", first.link);
  expect(JSON.parse(decoded.stdout).params).toEqual(first.params);
  expect(cli("mc", "--link", first.link).stderr).toContain("two-strategy links need sim strategies");
  expect(cli("strategies", "--live").status).not.toBe(0);
  expect(cli("strategies", "--weight", "1.1").status).not.toBe(0);
  expect(cli("strategies", "--link").status).not.toBe(0);
  const legacyView = new URL(first.link);
  const hash = new URLSearchParams(legacyView.hash.slice(1));
  hash.set("t", "overview");
  legacyView.hash = hash.toString();
  const legacy = cli("link", legacyView.toString(), "--full");
  expect(JSON.parse(legacy.stdout).params.deployment).toBe("lark4");
  hash.delete("t");
  legacyView.hash = hash.toString();
  expect(cli("cf", "--link", legacyView.toString()).stderr).toContain("two-strategy links need sim strategies");
});
