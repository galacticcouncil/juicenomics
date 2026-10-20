import { expect, it, vi } from "vitest";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { loadLive, DEPLOYMENTS } from "../src/engine/live/live";
import { LARK4, clone } from "../src/engine/params/defaults";

const uints = (...values: bigint[]) => encodeAbiParameters(values.map(() => ({ type: "uint256" })), values);
const addr = "0x0000000000000000000000000000000000000001";
const evmValues = () => {
  const out = [
    uints(106559018n),
    uints(500000n * 10n ** 8n, 400000n * 10n ** 8n, 0n, 8500n, 8000n, 107n * 10n ** 16n),
    encodeAbiParameters(parseAbiParameters("uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128"), [0n, 0n, 0n, 0n, 5n * 10n ** 25n, 0n, 0, 0, addr, addr, addr, addr, 0n, 0n, 0n]),
    uints((8500n << 16n) + 8000n), uints(106n * 10n ** 16n), uints(2500n * 10n ** 18n), uints(150n), uints(10n ** 15n), uints(2000n), uints(586779n * 10n ** 18n),
  ];
  for (const price of [3000n, 90000n]) out.push(uints(price * 10n ** 8n), uints((8500n << 16n) + 8000n), uints(10n ** 18n), uints(100n * 10n ** 18n), uints(3600n), encodeAbiParameters([{ type: "address" }], [addr]), uints(1000n * 10n ** 18n), uints(1000n * 10n ** 8n), uints(1000n));
  out.push(uints(2700n));
  return out;
};

it("live pool settings do not depend on JSON-RPC batch response ordering", async () => {
  let reverseStorage = false;
  const info = Buffer.alloc(32);
  info[0] = 8;
  info.writeUInt32LE(43, 1);
  info.writeUInt32LE(222, 5);
  info.writeUInt16LE(100, 9);
  info.writeUInt16LE(100, 11);
  info.writeUInt32LE(400, 21);
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
      const encoded = body.length === 29 ? evmValues() : body.length === 2 ? [uints(1000n * 10n ** 18n, 0n, 0n), uints(1000n * 10n ** 18n, 0n, 0n)] : [uints(106559018n)];
      result = body.map((c: { id: number }, i: number) => ({ jsonrpc: "2.0", id: c.id, result: encoded[i] }));
    }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  try {
    const normal = (await loadLive(DEPLOYMENTS[0], "https://fixture.invalid")).apply(clone(LARK4));
    reverseStorage = true;
    const reversed = (await loadLive(DEPLOYMENTS[0], "https://fixture.invalid")).apply(clone(LARK4));
    expect(reversed.pool).toEqual(normal.pool);
  } finally {
    vi.unstubAllGlobals();
  }
});
