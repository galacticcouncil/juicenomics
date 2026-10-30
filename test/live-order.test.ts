import { expect, it, vi } from "vitest";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { loadLive, DEPLOYMENTS } from "../src/engine/live/live";
import { LARK4, clone } from "../src/engine/params/defaults";

const uints = (...values: bigint[]) => encodeAbiParameters(values.map(() => ({ type: "uint256" })), values);
const addr = "0x0000000000000000000000000000000000000001";
const main = () => [
  uints(106559018n),
  uints(500000n * 10n ** 8n, 400000n * 10n ** 8n, 0n, 8500n, 8000n, 108n * 10n ** 16n),
  encodeAbiParameters(parseAbiParameters("uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128"), [0n, 0n, 0n, 0n, 5n * 10n ** 25n, 0n, 0, 0, addr, addr, addr, addr, 0n, 0n, 0n]),
  uints((8800n << 16n) + 8500n), uints(106n * 10n ** 16n), uints(2500n * 10n ** 18n), uints(150n), uints(10n ** 15n), uints(2700n),
  uints(4000n), uints(9000n), uints(5_000_000n * 10n ** 18n), uints(586779n * 10n ** 18n),
  uints(3000n * 10n ** 8n), uints((8500n << 16n) + 8000n),
  uints(90000n * 10n ** 8n), uints((8500n << 16n) + 8000n), uints(10n ** 18n), uints(3n * 10n ** 18n), uints(60n), encodeAbiParameters([{ type: "address" }], [addr]),
  uints(1000n * 10n ** 18n), uints(1000n * 10n ** 8n), uints(6900n), uints(500n, 1000n, 800n), encodeAbiParameters(parseAbiParameters("bool, uint16"), [true, 0]),
];

it("live pool settings do not depend on JSON-RPC batch response ordering, and a jBTC-only deployment reads its own settings", async () => {
  let reverseStorage = false;
  const info = Buffer.alloc(32);
  info[0] = 8;
  info.writeUInt32LE(43, 1);
  info.writeUInt32LE(222, 5);
  info.writeUInt16LE(100, 9);
  info.writeUInt16LE(100, 11);
  info.writeUInt32LE(100, 21);
  const balance = Buffer.alloc(48);
  balance.writeBigUInt64LE(455929149000n, 0);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    let result;
    if (!Array.isArray(body)) {
      const height = body.params[0] === "latest" ? 50000 : Number(body.params[0]);
      result = { jsonrpc: "2.0", id: body.id, result: { number: `0x${height.toString(16)}`, timestamp: `0x${(1700000000 + height * 12).toString(16)}` } };
    } else if (body[0].method === "state_getStorage") {
      result = [{ jsonrpc: "2.0", id: 1, result: `0x${info.toString("hex")}` }, { jsonrpc: "2.0", id: 2, result: `0x${balance.toString("hex")}` }];
      if (reverseStorage) result.reverse();
    } else {
      const encoded = body.length > 2 ? main() : body.length === 2 ? [uints(1000n * 10n ** 18n, 0n, 0n), uints(640n * 10n ** 18n)] : [uints(106559018n)];
      result = body.map((c: { id: number }, i: number) => ({ jsonrpc: "2.0", id: c.id, result: encoded[i] }));
    }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  try {
    const state = await loadLive(DEPLOYMENTS[0], "https://fixture.invalid");
    const normal = state.apply(clone(LARK4));
    reverseStorage = true;
    const reversed = (await loadLive(DEPLOYMENTS[0], "https://fixture.invalid")).apply(clone(LARK4));
    expect(reversed.pool).toEqual(normal.pool);
    expect(normal.pool.feeBps).toBe(1);
    expect([normal.vaults.btc.bandLo, normal.vaults.btc.bandTarget, normal.vaults.btc.bandHi]).toEqual([0.65, 0.75, 0.83]);
    expect(normal.policy.headroomOn).toBe(true);
    expect(normal.policy.reserveUsd).toBeCloseTo(640, 9);
    expect(normal.fees.loopDiscountCapUsd).toBe(5_000_000);
    expect(normal.fees.protocolFeeBps).toBe(6900);
    expect(normal.vaults.btc.tvlCap).toBe(3);
    expect(normal.vaults.eth.on).toBe(false);
    expect(normal.vaults.eth.mainDebt + normal.vaults.eth.loopEquityUsd).toBe(0);
    expect(normal.vaults.eth.price).toBe(3000);
    expect(normal.loop.hfLag).toBe(LARK4.loop.hfLag);
    expect(state.notes.some((n) => n.includes("still ramping"))).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
