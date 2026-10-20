import history from "../../data/history-1y.json";
import type { Params, VaultKey } from "../params/types";
import type { Rng } from "./rng";

/** hourly-or-coarser log-price increments for both vaults over the horizon */
export interface PricePaths {
  eth: Float64Array;
  btc: Float64Array;
}

const hist = { eth: history.GIGAETH, btc: history.tBTC };

function dailyReturns(series: number[]): number[] {
  return series.slice(1).map((x, i) => Math.log(x / series[i]));
}

/** multiplier applied on top of the paths at time t (days) */
export function stressFactor(p: Params, day: number): number {
  switch (p.market.stress) {
    case "v20":
      if (day < 20) return 1;
      if (day < 30) return 1 - 0.2 * ((day - 20) / 10);
      if (day < 40) return 0.8 + 0.16 * ((day - 30) / 10);
      return 0.96;
    case "crash30":
      if (day < 20) return 1;
      if (day < 22) return 1 - 0.3 * ((day - 20) / 2);
      return 0.7;
    case "bleed":
      return Math.exp(Math.log(0.6) * Math.min(1, day / Math.max(1, p.sim.horizonDays)));
    default:
      return 1;
  }
}

export function makePaths(p: Params, r: Rng, steps: number, dtYears: number): PricePaths {
  const out: PricePaths = { eth: new Float64Array(steps), btc: new Float64Array(steps) };
  const keys: VaultKey[] = ["eth", "btc"];
  const rho = Math.max(-1, Math.min(1, p.market.corr));
  const stepsPerDay = Math.max(1, Math.round(1 / (dtYears * 365)));
  if (p.market.pathModel === "gbm") {
    for (let i = 0; i < steps; i++) {
      const z1 = r.normal();
      const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * r.normal();
      keys.forEach((k, j) => {
        const v = p.vaults[k];
        let inc = (v.drift - (v.vol * v.vol) / 2) * dtYears + v.vol * Math.sqrt(dtYears) * (j ? z2 : z1);
        if (p.market.jumps && r.next() < 4 * dtYears) inc += (r.next() < 0.5 ? -1 : 1) * 0.08;
        out[k][i] = inc;
      });
    }
    return out;
  }
  // replay or block-bootstrap the last year of daily oracle returns, bridged to the step size
  const days = Math.ceil(steps / stepsPerDay);
  const ret = { eth: dailyReturns(hist.eth), btc: dailyReturns(hist.btc) };
  const n = ret.eth.length;
  const pick: number[] = [];
  if (p.market.pathModel === "historical") {
    const start = r.int(n);
    for (let d = 0; d < days; d++) pick.push((start + d) % n);
  } else {
    while (pick.length < days) {
      const s = r.int(n);
      for (let k = 0; k < 5 && pick.length < days; k++) pick.push((s + k) % n);
    }
  }
  for (let d = 0; d < days; d++) {
    keys.forEach((k) => {
      const daily = ret[k][pick[d]];
      const vol = p.vaults[k].vol;
      // brownian bridge: intraday noise that sums to the day's move
      const noise: number[] = [];
      for (let s = 0; s < stepsPerDay; s++) noise.push(r.normal() * vol * Math.sqrt(dtYears));
      const mean = noise.reduce((a, x) => a + x, 0) / stepsPerDay;
      for (let s = 0; s < stepsPerDay; s++) {
        const i = d * stepsPerDay + s;
        if (i < steps) out[k][i] = daily / stepsPerDay + noise[s] - mean + p.vaults[k].drift * dtYears;
      }
    });
  }
  return out;
}
