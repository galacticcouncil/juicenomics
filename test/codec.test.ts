import { describe, expect, it } from "vitest";
import { LARK4, clone } from "../src/engine/params/defaults";
import { preset, PRESETS } from "../src/engine/params/presets";
import { decode, diff, encode } from "../src/engine/share/codec";

describe("share links", () => {
  it("defaults encode to nothing", async () => {
    expect(await encode(clone(LARK4))).toBe("");
  });
  it("every preset round-trips", async () => {
    for (const p of PRESETS) {
      const params = preset(p.key);
      const token = await encode(params);
      const back = await decode(token);
      expect(back.error, p.key).toBeUndefined();
      expect(diff(back.params), p.key).toEqual(diff(params));
    }
  });
  it("garbage falls back to the defaults with an error", async () => {
    const r = await decode("1zgarbage!!");
    expect(r.error).toBeTruthy();
    expect(diff(r.params)).toEqual({});
  });
  it("unknown keys are ignored and out-of-range values clamped", async () => {
    const json = Buffer.from(JSON.stringify({ zz: 1, pf: 999 })).toString("base64url");
    const r = await decode(`1j${json}`);
    expect(r.ignored).toContain("zz");
    expect(r.params.pool.feeBps).toBe(30);
    expect(r.clamped.length).toBeGreaterThan(0);
  });
});

describe("link versions", () => {
  const v1 = (codes: Record<string, unknown>) => `1j${btoa(JSON.stringify(codes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  it("a v1 link keeps starting from the current state, its old default", async () => {
    const back = await decode(v1({ pf: 2 }));
    expect(back.error).toBeUndefined();
    expect(back.params.sim.initial).toBe("lark4");
  });
  it("a v1 link that chose a fresh start keeps it", async () => {
    expect((await decode(v1({ si: "fresh" }))).params.sim.initial).toBe("fresh");
  });
  it("new links start fresh unless they say otherwise", async () => {
    expect(LARK4.sim.initial).toBe("fresh");
    const p = clone(LARK4);
    p.sim.initial = "lark4";
    expect((await decode(await encode(p))).params.sim.initial).toBe("lark4");
  });
});
