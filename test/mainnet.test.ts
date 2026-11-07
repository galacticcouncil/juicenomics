import { afterEach, expect, it, vi } from "vitest";
import { DEPLOYMENTS, loadLive } from "../src/engine/live/live";
import { MAINNET, clone } from "../src/engine/params/defaults";
import { decode, encode } from "../src/engine/share/codec";

afterEach(() => vi.unstubAllGlobals());

it("mainnet links retain their chosen state while old deployment-free links stay on Lark 4", async () => {
  const p = clone(MAINNET);
  p.sim.stateBlock = 16_714_521;
  p.loop.collateralUsd = 62_526.90468174;
  const result = await decode(await encode(p, true));
  expect(result.error).toBeUndefined();
  expect(result.params.deployment).toBe("mainnet");
  expect(result.params.sim.stateBlock).toBe(p.sim.stateBlock);
  expect(result.params.loop.collateralUsd).toBeCloseTo(p.loop.collateralUsd, 1);
  expect(result.params.vaults.eth.on && !result.params.vaults.btc.on).toBe(true);
  expect((await decode("3je30")).params.deployment).toBe("lark4");
});

it("rejects a non-mainnet RPC before reading contracts", async () => {
  const fetch = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0xdeadbeef" }));
  vi.stubGlobal("fetch", fetch);
  await expect(loadLive(DEPLOYMENTS.find((d) => d.key === "mainnet")!)).rejects.toThrow("RPC is not Mainnet");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects stale finalized mainnet state rather than labeling it live", async () => {
  const dep = DEPLOYMENTS.find((d) => d.key === "mainnet")!;
  const methods: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const call = JSON.parse(String(init.body));
    methods.push(call.method);
    const results: Record<string, unknown> = {
      chain_getBlockHash: dep.genesis,
      chain_getFinalizedHead: "0x1234",
      chain_getHeader: { number: "0xff0af9" },
      eth_getBlockByNumber: { number: "0xff0af9", timestamp: `0x${(Math.floor(Date.now() / 1000) - 3600).toString(16)}` },
    };
    return Response.json({ jsonrpc: "2.0", id: call.id, result: results[call.method] });
  });
  await expect(loadLive(dep)).rejects.toThrow("more than three minutes old");
  expect(methods).not.toContain("eth_call");
});
