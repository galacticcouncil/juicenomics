import { LARK4, clone } from "../params/defaults";
import { BY_CODE, PARAMS, getPath, setPath } from "../params/schema";
import type { Params } from "../params/types";
import { validate } from "../params/validate";

// 2: a fresh start became the default (v1 links implied the current state)
export const VERSION = 2;
const MIGRATE: Record<number, (codes: Record<string, unknown>) => Record<string, unknown>> = {
  1: (codes) => ({ si: "lark4", ...codes }),
  2: (codes) => codes,
};

function quantize(value: unknown, step?: number): unknown {
  if (typeof value !== "number" || !step) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(value.toFixed(Math.min(12, decimals)));
}

/** params that differ from the Lark 4 defaults, keyed by url code */
export function diff(p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of PARAMS) {
    const a = getPath(p, d.path);
    const b = getPath(LARK4, d.path);
    if (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b)) : a !== b) {
      out[d.code] = quantize(a, d.step);
    }
  }
  return out;
}

export function apply(codes: Record<string, unknown>): { params: Params; ignored: string[] } {
  let p = clone(LARK4);
  const ignored: string[] = [];
  for (const [code, value] of Object.entries(codes)) {
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

/** a version-1 link's defaults, for the unversioned "b=0" those links used for a default scenario B */
export const LEGACY_DEFAULTS = `1j${b64(new TextEncoder().encode("{}"))}`;

export async function decode(token: string): Promise<{ params: Params; ignored: string[]; clamped: string[]; error?: string }> {
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
    return { params: v.params, ignored, clamped: v.clamped };
  } catch (error) {
    return { params: clone(LARK4), ignored: [], clamped: [], error: (error as Error).message };
  }
}
