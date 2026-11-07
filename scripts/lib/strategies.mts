import { readFileSync } from "node:fs";
import { evaluateStrategies, strategyParams, STRATEGY_DEFAULTS, STRATEGY_FIELDS, STRATEGY_MARKET, STRATEGY_SCOPE } from "../../src/engine/model/twoStrategy";
import { decodeStrategies, encodeStrategies } from "../../src/engine/share/strategies";
import { type Args } from "./config.mts";

export function strategyCommand(a: Args) {
  const allowed = ["params", "link", "config", "tvl", "weight", "fee", "pretty"];
  for (const key of Object.keys(a.flags)) if (!allowed.includes(key)) throw new Error(`strategies does not support --${key}`);
  for (const key of ["link", "config"]) if (a.flags[key] === true) throw new Error(`--${key} needs a value`);
  if (a.flags.params) return { defaults: STRATEGY_DEFAULTS, fields: STRATEGY_FIELDS };
  let p = { ...STRATEGY_DEFAULTS };
  if (typeof a.flags.link === "string") {
    const value = a.flags.link;
    const token = value.includes("#") ? new URLSearchParams(value.slice(value.indexOf("#") + 1)).get("ts") : value;
    if (!token) throw new Error("link has no two-strategy settings");
    p = decodeStrategies(token);
  }
  if (typeof a.flags.config === "string") {
    const config: unknown = JSON.parse(readFileSync(a.flags.config, "utf8"));
    strategyParams(config);
    p = strategyParams({ ...p, ...config as object });
  }
  for (const key of ["tvl", "weight", "fee"] as const) {
    if (a.flags[key] !== undefined) {
      if (typeof a.flags[key] !== "string" || !a.flags[key].trim()) throw new Error(`--${key} needs a number`);
      p[key] = Number(a.flags[key]);
    }
  }
  for (const entry of a.set) {
    const [key, value, ...extra] = entry.split("=");
    if (!key || !value?.trim() || extra.length) throw new Error("--set needs strategyKey=number (see strategies --params)");
    p = strategyParams({ ...p, [key]: Number(value) });
  }
  p = strategyParams(p);
  const url = new URL("https://juicenomics-two-strategy.lark.hydration.cloud/");
  url.hash = new URLSearchParams({ t: "strategies", ts: encodeStrategies(p) }).toString();
  return {
    link: url.toString(), params: p, result: evaluateStrategies(p),
    snapshot: { block: STRATEGY_MARKET.block, hash: STRATEGY_MARKET.hash, timestamp: STRATEGY_MARKET.timestamp },
    scope: STRATEGY_SCOPE,
  };
}
