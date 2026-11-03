import { expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters } from "viem";
import { loadLive, DEPLOYMENTS } from "../src/engine/live/live";
import { LARK0, LARK4, clone } from "../src/engine/params/defaults";

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

it("a jETH-only deployment reads its own vault and entry lane, and leaves jBTC's switch alone", async () => {
  const dep = DEPLOYMENTS.find((d) => d.key === "lark0")!;
  const S = dep.subLoop;
  const vault = dep.vaults.eth!.address;
  const ledger = "0x3a1c0fa2f877c84d2930e59637c111a31878dcdf";
  const controller = "0xe0983cedd797b38090e6dcde54af88aa6eb22edc";
  const aPrime = "0x4C892a298A9C6b4cEd988b3D6E9CF93333aADcF7";
  const group = `0x${"ab".repeat(32)}` as const;
  const lane = keccak256(encodeAbiParameters(parseAbiParameters("address, address, address"), [S, dep.hollar, aPrime]));
  const token = (id: number) => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, "0")}` as const;
  const responses = new Map<string, string>();
  const on = (to: string, sig: string, args: unknown[], result: string) => {
    const abi = parseAbi([sig]);
    responses.set(`${to.toLowerCase()}|${encodeFunctionData({ abi, functionName: (abi[0] as { name: string }).name, args } as never)}`, result);
  };
  on(dep.oracle, "function getAssetPrice(address) view returns (uint256)", [token(43)], uints(106794819n));
  on(dep.oracle, "function getAssetPrice(address) view returns (uint256)", [token(4200)], uints(229486000000n));
  on(dep.oracle, "function getAssetPrice(address) view returns (uint256)", [token(1000765)], uints(7680903000000n));
  on(dep.aavePool, "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)", [S], uints(33362n * 10n ** 8n, 27724n * 10n ** 8n, 0n, 8800n, 8500n, 1059n * 10n ** 15n));
  on(dep.aavePool, "function getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)", [dep.hollar], encodeAbiParameters(parseAbiParameters("uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128"), [0n, 0n, 0n, 0n, 44n * 10n ** 24n, 0n, 0, 0, addr, addr, addr, addr, 0n, 0n, 0n]));
  on(dep.aavePool, "function getConfiguration(address) view returns (uint256)", [token(43)], uints((8800n << 16n) + 8500n));
  on(dep.aavePool, "function getConfiguration(address) view returns (uint256)", [token(4200)], uints((8500n << 16n) + 8000n));
  on(dep.aavePool, "function getConfiguration(address) view returns (uint256)", [token(1000765)], uints((8500n << 16n) + 8000n));
  on(S, "function targetHf() view returns (uint256)", [], uints(105n * 10n ** 16n));
  on(S, "function deployTranche() view returns (uint256)", [], uints(2500n * 10n ** 18n));
  on(S, "function admissionMaxDeficitBps() view returns (uint16)", [], uints(250n));
  on(S, "function harvestThreshold() view returns (uint256)", [], uints(2n * 10n ** 14n));
  on(S, "function dcaSlippagePpm() view returns (uint32)", [], uints(3500n));
  on(S, "function executionController() view returns (address)", [], encodeAbiParameters([{ type: "address" }], [controller]));
  on(S, "function principalOf(address) view returns (uint256)", [vault], uints(5698n * 10n ** 18n));
  on(S, "function equityOf(address) view returns (uint256)", [vault], uints(5637n * 10n ** 8n));
  on(S, "function rebalanceBand(address) view returns (uint16,uint16,uint16)", [vault], uints(500n, 1000n, 800n));
  on(S, "function exitHeadroom(address) view returns (bool,uint16)", [vault], encodeAbiParameters(parseAbiParameters("bool, uint16"), [true, 0]));
  on(dep.discount, "function discountBps() view returns (uint16)", [], uints(4000n));
  on(dep.discount, "function loopDiscountBps() view returns (uint16)", [], uints(9000n));
  on(dep.discount, "function loopCap() view returns (uint256)", [], uints(5_000_000n * 10n ** 18n));
  on(dep.hollar, "function balanceOf(address) view returns (uint256)", ["0xcc45366cd42115dfe2609c3bd8a0e72016922af7"], uints(579812n * 10n ** 18n));
  on(vault, "function totalAssets() view returns (uint256)", [], uints(3310843066978193000n));
  on(vault, "function tvlCap() view returns (uint256)", [], uints(100n * 10n ** 18n));
  on(vault, "function withdrawalDelay() view returns (uint32)", [], uints(60n));
  on(vault, "function mainDebt() view returns (address)", [], encodeAbiParameters([{ type: "address" }], [ledger]));
  on(dep.feeController, "function protocolFeeBps(address) view returns (uint16)", [vault], uints(6900n));
  on(ledger, "function activePosition() view returns (uint256,uint256,uint256)", [], uints(5698n * 10n ** 18n, 0n, 0n));
  on(ledger, "function protocolReserve() view returns (uint256)", [], uints(1000n * 10n ** 18n));
  on(controller, "function limits(bytes32) view returns (bytes32,uint128,uint128)", [lane], encodeAbiParameters(parseAbiParameters("bytes32, uint128, uint128"), [group, 10n ** 18n, 2500n * 10n ** 18n]));
  on(controller, "function maxShortfallBps(bytes32) view returns (uint16)", [lane], uints(35n));
  on(controller, "function budgets(bytes32) view returns (address,uint128,uint128,uint128,uint64)", [group], encodeAbiParameters(parseAbiParameters("address, uint128, uint128, uint128, uint64"), [dep.hollar, 25_000n * 10n ** 18n, 10n * 10n ** 18n, 0n, 0n]));
  on(controller, "function pacing(bytes32) view returns (uint64,uint64,uint256)", [group], uints(60n, 0n, 0n));
  const asked = new Set<string>();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    let result;
    if (!Array.isArray(body)) {
      const height = body.params[0] === "latest" ? 1219 : Number(body.params[0]);
      result = { jsonrpc: "2.0", id: body.id, result: { number: `0x${height.toString(16)}`, timestamp: `0x${(1793658576 + height * 8).toString(16)}` } };
    } else if (body[0].method === "state_getStorage") {
      result = [{ jsonrpc: "2.0", id: 1, result: null }, { jsonrpc: "2.0", id: 2, result: null }];
    } else {
      result = body.map((c: { id: number; params: [{ to: string; data: string }] }) => {
        const key = `${c.params[0].to.toLowerCase()}|${c.params[0].data}`;
        asked.add(key);
        const r = responses.get(key);
        return r ? { jsonrpc: "2.0", id: c.id, result: r } : { jsonrpc: "2.0", id: c.id, error: { message: "unexpected call" } };
      });
    }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  try {
    const state = await loadLive(dep, "https://fixture.invalid");
    const p = state.apply(clone(LARK0));
    expect([...responses.keys()].filter((k) => !asked.has(k))).toEqual([]);
    expect(p.deployment).toBe("lark0");
    expect(p.vaults.eth.on).toBe(true);
    expect(p.vaults.btc.on).toBe(false);
    expect(p.vaults.btc.mainDebt + p.vaults.btc.loopPrincipal + p.vaults.btc.loopEquityUsd).toBe(0);
    expect(p.vaults.eth.units).toBeCloseTo(3.310843066978193, 12);
    expect(p.vaults.eth.tvlCap).toBe(100);
    expect([p.vaults.eth.bandLo, p.vaults.eth.bandTarget, p.vaults.eth.bandHi]).toEqual([0.65, 0.75, 0.83]);
    expect(p.policy.cooldownHours * 3600).toBeCloseTo(60, 9);
    expect([p.policy.headroomOn, p.policy.reserveUsd, p.fees.protocolFeeBps]).toEqual([true, 1000, 6900]);
    expect([p.loop.laneCapBps, p.loop.budgetCap, p.loop.budgetRefillPerSec, p.loop.paceSec]).toEqual([35, 25_000, 10, 60]);
    expect(p.sim.initial).toBe("lark4");
    expect(state.notes).toContain("no jBTC vault on Lark 0: its chain state is cleared and its toggle kept");
    expect(state.notes.some((n) => n.includes("pool 143 storage unreadable"))).toBe(true);
    const fromLark4 = state.apply(clone(LARK4));
    expect(fromLark4.deployment).toBe("lark0");
    expect(fromLark4.vaults.btc.on).toBe(false);
    expect(state.changes[0]).toBe("deployment (Lark 0's settings)");
  } finally {
    vi.unstubAllGlobals();
  }
});
