import { strategyParams, type StrategyParams } from "../model/twoStrategy";

export function encodeStrategies(p: StrategyParams): string {
  return "1." + btoa(JSON.stringify(strategyParams(p))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeStrategies(token: string): StrategyParams {
  if (!token.startsWith("1.") || token.length > 8000) throw new Error("unknown or invalid strategy link version");
  const body = token.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  return strategyParams(JSON.parse(atob(body)));
}
