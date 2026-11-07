import { readFileSync } from "node:fs";
import { evaluateVdot, vdotParams, VDOT_DEFAULTS, VDOT_FIELDS, VDOT_MARKET, VDOT_SCOPE } from "../../src/engine/model/vdot";
import { decodeVdot, encodeVdot } from "../../src/engine/share/vdot";
import { type Args } from "./config.mts";

export function vdotCommand(a: Args) {
  const allowed = ["params", "link", "config", "tvl", "fee", "pretty"];
  for (const key of Object.keys(a.flags)) if (!allowed.includes(key)) throw new Error(`vdot does not support --${key}`);
  for (const key of ["link", "config"]) if (a.flags[key] === true) throw new Error(`--${key} needs a value`);
  if (a.flags.params) return { defaults: VDOT_DEFAULTS, fields: VDOT_FIELDS, useEMode: { type: "boolean", default: true }, fundingAsset: { values: ["DOT", "HOLLAR"], default: "DOT" } };
  let p = { ...VDOT_DEFAULTS };
  if (typeof a.flags.link === "string") {
    const value = a.flags.link;
    const token = value.includes("#") ? new URLSearchParams(value.slice(value.indexOf("#") + 1)).get("vd") : value;
    if (!token) throw new Error("link has no vDOT settings");
    p = decodeVdot(token);
  }
  if (typeof a.flags.config === "string") {
    const config: unknown = JSON.parse(readFileSync(a.flags.config, "utf8"));
    vdotParams(config);
    p = vdotParams({ ...p, ...config as object });
  }
  for (const key of ["tvl", "fee"] as const) {
    if (a.flags[key] !== undefined) {
      if (typeof a.flags[key] !== "string" || !a.flags[key].trim()) throw new Error(`--${key} needs a number`);
      p[key] = Number(a.flags[key]);
    }
  }
  for (const entry of a.set) {
    const [key, value, ...extra] = entry.split("=");
    if (!key || !value?.trim() || extra.length) throw new Error("--set needs key=value (see vdot --params)");
    if (key === "useEMode" && value !== "true" && value !== "false") throw new Error("useEMode needs true or false");
    p = vdotParams({ ...p, [key]: key === "fundingAsset" ? value : key === "useEMode" ? value === "true" : key === "dotBorrowApr" && value === "null" ? null : Number(value) });
  }
  p = vdotParams(p);
  const url = new URL("https://juicenomics-vdot.lark.hydration.cloud/");
  url.hash = new URLSearchParams({ t: "vdot", vd: encodeVdot(p) }).toString();
  return { link: url.toString(), params: p, result: evaluateVdot(p), scope: VDOT_SCOPE,
    snapshot: { block: VDOT_MARKET.block, hash: VDOT_MARKET.hash, timestamp: VDOT_MARKET.timestamp } };
}
