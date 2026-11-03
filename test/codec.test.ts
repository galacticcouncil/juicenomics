import { describe, expect, it } from "vitest";
import { DEPLOYMENT_KEYS, LARK0, LARK4, clone } from "../src/engine/params/defaults";
import { preset, presetsFor, PRESETS } from "../src/engine/params/presets";
import { BY_CODE } from "../src/engine/params/schema";
import { decode, diff, encode } from "../src/engine/share/codec";

describe("share links", () => {
  it("defaults encode to nothing", async () => {
    expect(await encode(clone(LARK4))).toBe("");
  });
  it("every preset round-trips on every deployment", async () => {
    for (const dep of DEPLOYMENT_KEYS) {
      for (const p of presetsFor(dep)) {
        const params = preset(p.key, dep);
        const token = await encode(params);
        const back = await decode(token);
        expect(back.error, `${dep} ${p.key}`).toBeUndefined();
        expect(back.params.deployment, `${dep} ${p.key}`).toBe(params.deployment);
        expect(diff(back.params), `${dep} ${p.key}`).toEqual(diff(params));
      }
    }
    expect(PRESETS.filter((p) => p.only).map((p) => p.key)).toEqual(["jeth", "jbtc"]);
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

describe("deployments", () => {
  it("a Lark 0 scenario carries its deployment and only what differs from Lark 0", async () => {
    expect(BY_CODE.has("dp")).toBe(false);
    expect(diff(clone(LARK0))).toEqual({ dp: "lark0" });
    const p = clone(LARK0);
    p.pool.feeBps = 4;
    expect(diff(p)).toEqual({ dp: "lark0", pf: 4 });
    const back = await decode(await encode(p));
    expect(back.error).toBeUndefined();
    expect(back.params.deployment).toBe("lark0");
    expect(back.params.vaults.eth.on && !back.params.vaults.btc.on).toBe(true);
    expect(back.params.loop.laneCapBps).toBe(35);
    expect(back.params.pool.feeBps).toBe(4);
  });
  it("links without a deployment stay Lark 4's", async () => {
    const v3 = `3j${Buffer.from(JSON.stringify({ pf: 4 })).toString("base64url")}`;
    const back = await decode(v3);
    expect(back.params.deployment).toBe("lark4");
    expect(diff(back.params)).toEqual({ pf: 4 });
    expect(await encode(clone(LARK4))).toBe("");
  });
  it("an unknown deployment falls back to Lark 4 and says so", async () => {
    const back = await decode(`3j${Buffer.from(JSON.stringify({ dp: "lark9", pf: 4 })).toString("base64url")}`);
    expect(back.params.deployment).toBe("lark4");
    expect(back.ignored).toEqual(["dp"]);
    expect(back.params.pool.feeBps).toBe(4);
  });
  it("deployment presets switch the chain, the rest stay on it", () => {
    expect(preset("lark0").deployment).toBe("lark0");
    expect(preset("lark4", "lark0").deployment).toBe("lark4");
    const q = preset("noHeadroom", "lark0");
    expect(q.deployment).toBe("lark0");
    expect(q.policy.headroomOn).toBe(false);
    expect(preset("jbtc", "lark0").vaults.btc.on).toBe(true);
  });
});

describe("link versions", () => {
  const vn = (n: number) => (codes: Record<string, unknown>) => `${n}j${btoa(JSON.stringify(codes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const v1 = vn(1);
  const v2 = vn(2);
  it("a v1 link keeps starting from the current state, its old default", async () => {
    const back = await decode(v1({ pf: 2 }));
    expect(back.error).toBeUndefined();
    expect(back.params.sim.initial).toBe("lark4");
  });
  it("a v1 link that chose a fresh start keeps it", async () => {
    expect((await decode(v1({ si: "fresh" }))).params.sim.initial).toBe("fresh");
  });
  it("a v2 link opens with its era's settings: both vaults, the old band and fees, no headroom exits", async () => {
    const back = await decode(v2({ pf: 2 }));
    expect(back.error).toBeUndefined();
    expect(back.era).toBe(2);
    const p = back.params;
    expect(p.pool.feeBps).toBe(2);
    expect(p.vaults.eth.on && p.vaults.btc.on).toBe(true);
    [0.75, 0.8, 0.83].forEach((x, i) => expect([p.vaults.btc.bandLo, p.vaults.btc.bandTarget, p.vaults.btc.bandHi][i]).toBeCloseTo(x, 9));
    expect([p.fees.protocolFeeBps, p.fees.discountMain, p.fees.discountLoop]).toEqual([500, 0, 0]);
    expect(p.policy.headroomOn).toBe(false);
    expect(p.policy.reserveUsd).toBe(0);
    expect(p.loop.paceSec).toBe(0);
    expect(p.sim.initial).toBe("fresh");
    expect(p.vaults.eth.units).toBeCloseTo(23.07, 2);
  });
  it("a v2 link that turned headroom exits on keeps them", async () => {
    expect((await decode(v2({ xO: true }))).params.policy.headroomOn).toBe(true);
  });
  it("a v1 link still reaches the v2 era, from the current state", async () => {
    const p = (await decode(v1({}))).params;
    expect(p.sim.initial).toBe("lark4");
    expect(p.vaults.eth.on).toBe(true);
    expect(p.fees.protocolFeeBps).toBe(500);
  });
  it("new links start fresh unless they say otherwise", async () => {
    expect(LARK4.sim.initial).toBe("fresh");
    const p = clone(LARK4);
    p.sim.initial = "lark4";
    expect((await decode(await encode(p))).params.sim.initial).toBe("lark4");
  });
});
