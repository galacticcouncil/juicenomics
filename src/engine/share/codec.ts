import v2 from "../../data/defaults-v2.json";
import { BASELINES, LARK4, baseline, clone, isDeployment } from "../params/defaults";
import { BY_CODE, PARAMS, getPath, setPath } from "../params/schema";
import type { Params } from "../params/types";
import { validate } from "../params/validate";

// 2: a fresh start became the default (v1 links implied the current state)
// 3: the 30 Oct refork (jBTC alone, headroom exits); older links spell out their era's defaults, both vaults and none of the later mechanics
// a link off Lark 4 carries its deployment as "dp" and differs from that deployment's settings; a link without one is Lark 4's
export const VERSION = 3;
const DEPLOYMENT_CODE = "dp";
const V2_ERA: Record<string, unknown> = { ...v2, eO: true, bO: true, xO: false, xG: 0, xR: 0, dC: 1e9, lP: 0 };
const MIGRATE: Record<number, (codes: Record<string, unknown>) => Record<string, unknown>> = {
  1: (codes) => MIGRATE[2]({ si: "lark4", ...codes }),
  2: (codes) => ({ ...V2_ERA, ...codes }),
  3: (codes) => codes,
};

/** a link version's own defaults: the token an omitted scenario of that era stands for */
export const eraDefaults = (version: number) => `${version}j${b64(new TextEncoder().encode("{}"))}`;

function quantize(value: unknown, step?: number): unknown {
  if (typeof value !== "number" || !step) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(value.toFixed(Math.min(12, decimals)));
}

/** params that differ from their deployment's settings, keyed by url code */
export function diff(p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const base = baseline(p.deployment);
  if (base !== LARK4) out[DEPLOYMENT_CODE] = base.deployment;
  for (const d of PARAMS) {
    const a = getPath(p, d.path);
    const b = getPath(base, d.path);
    if (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b)) : a !== b) {
      out[d.code] = quantize(a, d.step);
    }
  }
  return out;
}

export function apply(codes: Record<string, unknown>): { params: Params; ignored: string[] } {
  const dep = codes[DEPLOYMENT_CODE];
  let p = clone(isDeployment(dep) ? BASELINES[dep] : LARK4);
  const ignored: string[] = dep === undefined || isDeployment(dep) ? [] : [DEPLOYMENT_CODE];
  for (const [code, value] of Object.entries(codes)) {
    if (code === DEPLOYMENT_CODE) continue;
    const d = BY_CODE.get(code);
    if (!d) {
      ignored.push(code);
      continue;
    }
    const ok =
      (d.kind === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (d.kind === "bool" && typeof value === "boolean") ||
      (d.kind === "enum" && typeof value === "string" && d.options?.some((o) => o.value === value));
    if (!ok) {
      ignored.push(code);
      continue;
    }
    p = setPath(p, d.path, value);
  }
  return { params: p, ignored };
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** the empty string for the defaults, unless `always`: then a versioned token, so the defaults keep their version */
export async function encode(p: Params, always = false): Promise<string> {
  const d = diff(p);
  if (!Object.keys(d).length) return always ? `${VERSION}j${b64(new TextEncoder().encode("{}"))}` : "";
  const json = new TextEncoder().encode(JSON.stringify(d));
  if (typeof CompressionStream !== "undefined") {
    return `${VERSION}z${b64(await pipe(json, new CompressionStream("deflate-raw")))}`;
  }
  return `${VERSION}j${b64(json)}`;
}

export async function decode(token: string): Promise<{ params: Params; ignored: string[]; clamped: string[]; error?: string; era?: number }> {
  if (!token) return { params: clone(LARK4), ignored: [], clamped: [] };
  try {
    const version = Number.parseInt(token, 10);
    const tag = token[String(version).length];
    const body = token.slice(String(version).length + 1);
    const migrate = MIGRATE[version];
    if (!migrate) throw new Error(`unknown link version ${version}`);
    const bytes = tag === "z" ? await pipe(unb64(body), new DecompressionStream("deflate-raw")) : unb64(body);
    const codes = migrate(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
    const { params, ignored } = apply(codes);
    const v = validate(params);
    return { params: v.params, ignored, clamped: v.clamped, era: version < VERSION ? version : undefined };
  } catch (error) {
    return { params: clone(LARK4), ignored: [], clamped: [], error: (error as Error).message };
  }
}
