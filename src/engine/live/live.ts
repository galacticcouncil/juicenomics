import { decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Hex } from "viem";
import type { Params, VaultKey } from "../params/types";

export interface Deployment {
  key: string;
  label: string;
  rpc: string;
  subLoop: Hex;
  aavePool: Hex;
  oracle: Hex;
  feeController: Hex;
  discount: Hex;
  hollar: Hex;
  vaults: Record<VaultKey, { address: Hex; asset: number }>;
}

const token = (id: number) => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, "0")}` as Hex;

export const DEPLOYMENTS: Deployment[] = [
  {
    key: "lark4",
    label: "Lark 4 (testnet)",
    rpc: "https://node4.lark.hydration.cloud",
    subLoop: "0xe0983cedd797b38090e6dcde54af88aa6eb22edc",
    aavePool: "0x1b02E051683b5cfaC5929C25E84adb26ECf87B38",
    oracle: "0xAD33C0F0C42C5A0EAA65b5895D2BdB20cb6E8760",
    feeController: "0xa64e418978482d5de91717cf6c77e1f40105f2ab",
    discount: "0x423e733c04e94f689f2dcbad88c3b71db44aad70",
    hollar: "0x531a654d1696ED52e7275A8cede955E82620f99a",
    vaults: {
      eth: { address: "0x79b41c78a2b5ac1ddc3c80877449b1cc8f850c46", asset: 4200 },
      btc: { address: "0x2c66100c46d15d6b826ba2a89f2d31e3ca47a153", asset: 1000765 },
    },
  },
];

// pool 143 is the same on every Hydration fork: its storage keys and account are fixed
const POOL143_INFO_KEY = "0x58972220a05bbe4c157921de509b53164c72016d74b63ae83d79b02efdb5528e1a6906ea1ac9ff1b301b2e81618dd8488f000000";
const POOL143_PRIME_KEY = "0x99971b5749ac43e0235e41b0d37869188ee7418a6531173d60d1f6a82d8f4d5193be8ab8631ecbabbcd6391dee547297cc45366cd42115dfe2609c3bd8a0e72016922af77a40038b6fc34ec112f6d4356bedfbd1761799352b000000";
const POOL143_EVM = "0xcc45366cd42115dfe2609c3bd8a0e72016922af7";
const PRIME = token(43);

interface Call {
  to: Hex;
  sig: string;
  args?: unknown[];
}

async function rpc(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function ethCalls(url: string, calls: Call[], block: string): Promise<unknown[]> {
  const prepared = calls.map((c) => {
    const abi = parseAbi([c.sig]) as Abi;
    const fn = (abi[0] as { name: string }).name;
    return { abi, fn, data: encodeFunctionData({ abi, functionName: fn, args: c.args ?? [] } as never) };
  });
  const out = (await rpc(url, prepared.map((x, i) => ({ jsonrpc: "2.0", id: i, method: "eth_call", params: [{ to: calls[i].to, data: x.data }, block] })))) as { id: number; result?: Hex; error?: { message: string } }[];
  const byId = new Map(out.map((r) => [r.id, r]));
  return prepared.map((x, i) => {
    const r = byId.get(i);
    if (!r?.result) throw new Error(`${calls[i].sig.split("(")[0].replace("function ", "")}: ${r?.error?.message ?? "no result"}`);
    return decodeFunctionResult({ abi: x.abi, functionName: x.fn, data: r.result } as never);
  });
}

const n = (x: unknown, dec: number) => Number(x as bigint) / 10 ** dec;
const u128le = (hex: string, offset: number) => {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) + BigInt(parseInt(hex.slice(2 + (offset + i) * 2, 4 + (offset + i) * 2), 16));
  return v;
};
const uLe = (hex: string, offset: number, bytes: number) => {
  let v = 0;
  for (let i = bytes - 1; i >= 0; i--) v = v * 256 + parseInt(hex.slice(2 + (offset + i) * 2, 4 + (offset + i) * 2), 16);
  return v;
};

export interface LiveState {
  deployment: string;
  block: number;
  timestamp: number;
  apply: (p: Params) => Params;
  changes: string[];
  notes: string[];
}

/** read the running chain at its head and build the settings that describe it */
export async function loadLive(dep: Deployment, url = dep.rpc): Promise<LiveState> {
  const head = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] })) as { result: { number: Hex; timestamp: Hex } };
  const blockHex = head.result.number;
  const block = Number(blockHex);
  const timestamp = Number(head.result.timestamp);
  const keys: VaultKey[] = ["eth", "btc"];
  const S = dep.subLoop;
  const calls: Call[] = [
    { to: dep.oracle, sig: "function getAssetPrice(address) view returns (uint256)", args: [PRIME] },
    { to: dep.aavePool, sig: "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)", args: [S] },
    { to: dep.aavePool, sig: "function getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)", args: [dep.hollar] },
    { to: dep.aavePool, sig: "function getConfiguration(address) view returns (uint256)", args: [PRIME] },
    { to: S, sig: "function targetHf() view returns (uint256)" },
    { to: S, sig: "function deployTranche() view returns (uint256)" },
    { to: S, sig: "function admissionMaxDeficitBps() view returns (uint16)" },
    { to: S, sig: "function harvestThreshold() view returns (uint256)" },
    { to: dep.discount, sig: "function discountBps() view returns (uint16)" },
    { to: dep.hollar, sig: "function balanceOf(address) view returns (uint256)", args: [POOL143_EVM] },
  ];
  for (const k of keys) {
    const v = dep.vaults[k];
    calls.push(
      { to: dep.oracle, sig: "function getAssetPrice(address) view returns (uint256)", args: [token(v.asset)] },
      { to: dep.aavePool, sig: "function getConfiguration(address) view returns (uint256)", args: [token(v.asset)] },
      { to: v.address, sig: "function totalAssets() view returns (uint256)" },
      { to: v.address, sig: "function tvlCap() view returns (uint256)" },
      { to: v.address, sig: "function withdrawalDelay() view returns (uint32)" },
      { to: v.address, sig: "function mainDebt() view returns (address)" },
      { to: S, sig: "function principalOf(address) view returns (uint256)", args: [v.address] },
      { to: S, sig: "function equityOf(address) view returns (uint256)", args: [v.address] },
      { to: dep.feeController, sig: "function protocolFeeBps(address) view returns (uint16)", args: [v.address] },
    );
  }
  calls.push({ to: S, sig: "function dcaSlippagePpm() view returns (uint32)" });
  const r = await ethCalls(url, calls, blockHex);
  const ledgers = keys.map((_, i) => r[10 + i * 9 + 5] as Hex);
  const positions = await ethCalls(url, ledgers.map((l) => ({ to: l, sig: "function activePosition() view returns (uint256,uint256,uint256)" })), blockHex);
  const [info, primeRes] = (await rpc(url, [
    { jsonrpc: "2.0", id: 1, method: "state_getStorage", params: [POOL143_INFO_KEY] },
    { jsonrpc: "2.0", id: 2, method: "state_getStorage", params: [POOL143_PRIME_KEY] },
  ])) as { id: number; result: string | null }[];
  const notes: string[] = [];

  // PRIME's yield over the last week from its oracle drift
  let primeYield: number | null = null;
  try {
    const back = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${Math.max(1, block - 20_000).toString(16)}`, false] })) as { result: { number: Hex; timestamp: Hex } };
    const secPerBlock = (timestamp - Number(back.result.timestamp)) / (block - Number(back.result.number));
    const weekAgo = Math.max(1, Math.round(block - (7 * 86400) / Math.max(1, secPerBlock)));
    const [past] = await ethCalls(url, [calls[0]], `0x${weekAgo.toString(16)}`);
    const pastBlock = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${weekAgo.toString(16)}`, false] })) as { result: { timestamp: Hex } };
    const years = (timestamp - Number(pastBlock.result.timestamp)) / (365 * 86400);
    const y = Math.log(n(r[0], 8) / n(past, 8)) / years;
    if (years > 1 / 365 && Number.isFinite(y) && y > -0.5 && y < 1) primeYield = y;
  } catch {
    notes.push("PRIME yield kept: the node didn't serve last week's oracle price");
  }

  const acct = r[1] as bigint[];
  const hollarRes = r[2] as bigint[];
  const cfg = (x: unknown) => ({ ltv: Number((x as bigint) & 0xffffn) / 1e4, lt: Number(((x as bigint) >> 16n) & 0xffffn) / 1e4 });
  const primeCfg = cfg(r[3]);
  const live = {
    primePrice: n(r[0], 8),
    collateralUsd: n(acct[0], 8),
    debtUsd: n(acct[1], 8),
    hf: n(acct[5], 18),
    hollarRate: n(hollarRes[4], 27),
    primeLt: primeCfg.lt,
    targetHf: n(r[4], 18),
    tranche: n(r[5], 18),
    admission: Number(r[6]),
    harvestThreshold: n(r[7], 18),
    costReservePpm: Number(r[10 + keys.length * 9]),
    discount: Number(r[8]) / 1e4,
    poolHollar: n(r[9], 18),
    poolPrime: primeRes?.result ? Number(u128le(primeRes.result, 0)) / 1e6 : NaN,
    amp: info?.result ? uLe(info.result, 1 + 8 + 2, 2) : NaN,
    feeBps: info?.result ? uLe(info.result, 1 + 8 + 2 + 2 + 4 + 4, 4) / 100 : NaN,
  };
  const vaults = keys.map((k, i) => {
    const b = 10 + i * 9;
    const c = cfg(r[b + 1]);
    return {
      k,
      price: n(r[b], 8),
      ltv: c.ltv,
      lt: c.lt,
      units: n(r[b + 2], 18),
      tvlCap: n(r[b + 3], 18),
      cooldown: Number(r[b + 4]) / 3600,
      mainDebt: n((positions[i] as bigint[])[0], 18),
      principal: n(r[b + 6], 18),
      equity: n(r[b + 7], 8),
      fee: Number(r[b + 8]),
    };
  });
  if (!Number.isFinite(live.poolPrime) || !Number.isFinite(live.amp)) notes.push("pool 143 storage unreadable; pool settings kept");

  const changes: string[] = [];
  const apply = (input: Params): Params => {
    const p = structuredClone(input);
    const set = <T>(label: string, cur: T, next: T, write: (v: T) => void) => {
      if (typeof next === "number" && !Number.isFinite(next)) return;
      if (cur !== next) changes.push(label);
      write(next);
    };
    changes.length = 0;
    set("PRIME price", p.market.primePrice, live.primePrice, (v) => { p.market.primePrice = v; });
    set("HOLLAR rate", p.market.hollarRate, live.hollarRate, (v) => { p.market.hollarRate = v; });
    if (primeYield != null) set("PRIME yield (7 d)", p.market.primeYield, primeYield, (v) => { p.market.primeYield = v; });
    set("target HF", p.loop.targetHf, live.targetHf, (v) => { p.loop.targetHf = v; });
    set("HF lag", p.loop.hfLag, Math.max(0, Math.min(0.05, live.hf - live.targetHf)), (v) => { p.loop.hfLag = v; });
    set("PRIME LT", p.loop.primeLt, live.primeLt, (v) => { p.loop.primeLt = v; });
    set("entry tranche", p.loop.tranche, live.tranche, (v) => { p.loop.tranche = v; });
    set("loop collateral", p.loop.collateralUsd, live.collateralUsd, (v) => { p.loop.collateralUsd = v; });
    set("loop debt", p.loop.debtUsd, live.debtUsd, (v) => { p.loop.debtUsd = v; });
    set("pool PRIME", p.pool.prime, live.poolPrime, (v) => { p.pool.prime = v; });
    set("pool HOLLAR", p.pool.hollar, live.poolHollar, (v) => { p.pool.hollar = v; });
    set("pool amplification", p.pool.amp, live.amp, (v) => { p.pool.amp = v; });
    set("pool fee", p.pool.feeBps, live.feeBps, (v) => { p.pool.feeBps = v; });
    set("admission cap", p.policy.admissionBps, live.admission, (v) => { p.policy.admissionBps = v; });
    set("harvest threshold", p.policy.harvestThresholdBps, live.harvestThreshold * 1e4, (v) => { p.policy.harvestThresholdBps = v; });
    set("execution-cost allowance", p.policy.costReserveBps, live.costReservePpm / 100, (v) => { p.policy.costReserveBps = v; });
    set("vault HOLLAR discount", p.fees.discountMain, live.discount, (v) => { p.fees.discountMain = v; });
    set("protocol fee", p.fees.protocolFeeBps, vaults[0].fee, (v) => { p.fees.protocolFeeBps = v; });
    set("withdrawal cooldown", p.policy.cooldownHours, vaults[0].cooldown, (v) => { p.policy.cooldownHours = v; });
    for (const v of vaults) {
      const pv = p.vaults[v.k];
      const name = pv.name;
      // bands follow max LTV when they still sit at the contract's fixed offsets
      const atDefault = Math.abs(pv.bandTarget - pv.maxLtv) < 1e-9 && Math.abs(pv.bandLo - (pv.maxLtv - 0.05)) < 1e-9 && Math.abs(pv.bandHi - (pv.maxLtv + 0.03)) < 1e-9;
      set(`${name} collateral price`, pv.price, v.price, (x) => { pv.price = x; });
      set(`${name} max LTV`, pv.maxLtv, v.ltv, (x) => { pv.maxLtv = x; });
      if (atDefault) {
        pv.bandTarget = v.ltv;
        pv.bandLo = v.ltv - 0.05;
        pv.bandHi = v.ltv + 0.03;
      }
      set(`${name} LT`, pv.lt, v.lt, (x) => { pv.lt = x; });
      set(`${name} deposits`, pv.units, v.units, (x) => { pv.units = x; });
      set(`${name} TVL cap`, pv.tvlCap, v.tvlCap, (x) => { pv.tvlCap = x; });
      set(`${name} Main debt`, pv.mainDebt, v.mainDebt, (x) => { pv.mainDebt = x; });
      set(`${name} loop principal`, pv.loopPrincipal, v.principal, (x) => { pv.loopPrincipal = x; });
      set(`${name} loop equity`, pv.loopEquityUsd, v.equity, (x) => { pv.loopEquityUsd = x; });
    }
    p.sim.initial = "lark4";
    p.sim.stateBlock = block;
    return p;
  };
  return { deployment: dep.key, block, timestamp, apply, changes, notes };
}
