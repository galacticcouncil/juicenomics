import { readFileSync } from "node:fs";
import { DEPLOYMENTS, loadLive } from "../../src/engine/live/live";
import { LARK4, clone } from "../../src/engine/params/defaults";
import { PRESETS, preset } from "../../src/engine/params/presets";
import { BY_PATH, setPath } from "../../src/engine/params/schema";
import type { Params, VaultKey } from "../../src/engine/params/types";
import { validate } from "../../src/engine/params/validate";
import { decode } from "../../src/engine/share/codec";

export interface Args {
  _: string[];
  set: string[];
  flags: Record<string, string | true>;
}

/** --key value, --key=value, --flag, repeatable --set path=value; everything else is positional */
export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], set: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = a.slice(2, eq > 0 ? eq : undefined);
    let value: string | true = true;
    if (eq > 0) value = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) value = argv[++i];
    if (key === "set") {
      if (value === true) throw new Error("--set needs path=value");
      out.set.push(value);
    } else out.flags[key] = value;
  }
  return out;
}

export const flag = (a: Args, k: string) => a.flags[k];
export const num = (a: Args, k: string, d: number) => (a.flags[k] === undefined ? d : Number(a.flags[k]));
export const str = (a: Args, k: string, d: string) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : d);

/** parse a --set value against the parameter's kind */
export function parseValue(path: string, raw: string): unknown {
  const d = BY_PATH.get(path);
  if (!d) throw new Error(`unknown parameter ${path} (see: sim params)`);
  if (d.kind === "number") {
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new Error(`${path} needs a number, got ${raw}`);
    return v;
  }
  if (d.kind === "bool") {
    if (raw !== "true" && raw !== "false") throw new Error(`${path} needs true or false, got ${raw}`);
    return raw === "true";
  }
  if (!d.options?.some((o) => o.value === raw)) throw new Error(`${path} is one of ${d.options?.map((o) => o.value).join(", ")}; got ${raw}`);
  return raw;
}

/** both vaults to a total TVL at today's split; their chain positions scale with them and the caps come off */
export function scaleTvl(p: Params, totalUsd: number): Params {
  const q = clone(p);
  const keys: VaultKey[] = ["eth", "btc"];
  const cur = keys.reduce((a, k) => a + q.vaults[k].units * q.vaults[k].price, 0);
  const m = cur > 0 ? totalUsd / cur : 1;
  for (const k of keys) {
    const v = q.vaults[k];
    v.units *= m;
    v.mainDebt *= m;
    v.loopPrincipal *= m;
    v.loopEquityUsd *= m;
    v.capOn = false;
  }
  q.loop.collateralUsd *= m;
  q.loop.debtUsd *= m;
  return q;
}

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof target[k] === "object") deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}

/** defaults ← --preset ← --link ← --config ← --live ← --tvl ← --set, then validation */
export async function buildParams(a: Args): Promise<{ params: Params; notes: string[] }> {
  const notes: string[] = [];
  let p = clone(LARK4);
  const pre = flag(a, "preset");
  if (typeof pre === "string") {
    if (!PRESETS.some((x) => x.key === pre)) throw new Error(`unknown preset ${pre} (see: sim presets)`);
    p = preset(pre);
  }
  const link = flag(a, "link");
  if (typeof link === "string") {
    const token = link.includes("#") ? (new URLSearchParams(link.slice(link.indexOf("#") + 1)).get("s") ?? "") : link.replace(/^s=/, "");
    const d = await decode(token);
    if (d.error) throw new Error(`link: ${d.error}`);
    p = d.params;
    if (d.ignored.length) notes.push(`link ignored ${d.ignored.join(", ")}`);
  }
  const config = flag(a, "config");
  if (typeof config === "string") {
    const json = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
    const flat = Object.keys(json).every((k) => k.includes("."));
    if (flat) for (const [k, v] of Object.entries(json)) p = setPath(p, k, typeof v === "string" ? parseValue(k, v) : v);
    else {
      const q = clone(p) as unknown as Record<string, unknown>;
      deepMerge(q, json);
      p = q as unknown as Params;
    }
  }
  if (flag(a, "live")) {
    const dep = DEPLOYMENTS.find((d) => d.key === str(a, "deployment", "lark4")) ?? DEPLOYMENTS[0];
    const at = flag(a, "block");
    const s = await loadLive(dep, str(a, "rpc", dep.rpc), typeof at === "string" ? Number(at) : undefined);
    p = s.apply(p);
    notes.push(`live state from ${dep.label} at block ${s.block}: ${s.changes.join(", ") || "nothing changed"}`, ...s.notes);
  }
  const tvl = flag(a, "tvl");
  if (typeof tvl === "string") p = scaleTvl(p, Number(tvl));
  for (const kv of a.set) {
    const i = kv.indexOf("=");
    if (i < 0) throw new Error(`--set ${kv}: needs path=value`);
    const path = kv.slice(0, i);
    p = setPath(p, path, parseValue(path, kv.slice(i + 1)));
  }
  const v = validate(p);
  return { params: v.params, notes: [...notes, ...v.clamped.map((c) => `clamped ${c}`), ...v.issues] };
}
