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
  vaults: Partial<Record<VaultKey, { address: Hex; asset: number }>>;
  /** read for price and reserve config even where the deployment has no such vault */
  assets: Record<VaultKey, number>;
}

const token = (id: number) => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, "0")}` as Hex;

export const DEPLOYMENTS: Deployment[] = [
  {
    key: "lark4",
    label: "Lark 4 (testnet, jBTC only)",
    rpc: "https://node4.lark.hydration.cloud",
    subLoop: "0xe0983cedd797b38090e6dcde54af88aa6eb22edc",
    aavePool: "0x1b02E051683b5cfaC5929C25E84adb26ECf87B38",
    oracle: "0xAD33C0F0C42C5A0EAA65b5895D2BdB20cb6E8760",
    feeController: "0xa64e418978482d5de91717cf6c77e1f40105f2ab",
    discount: "0x5bb401114feb59200e4e3ceace6fc5a7dea998fa",
    hollar: "0x531a654d1696ED52e7275A8cede955E82620f99a",
    vaults: { btc: { address: "0x79b41c78a2b5ac1ddc3c80877449b1cc8f850c46", asset: 1000765 } },
    assets: { eth: 4200, btc: 1000765 },
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
  /** undefined instead of an error: older contracts lack it, or the asset isn't listed */
  optional?: boolean;
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
    if (!r?.result || r.result === "0x") {
      if (calls[i].optional) return undefined;
      throw new Error(`${calls[i].sig.split("(")[0].replace("function ", "")}: ${r?.error?.message ?? "no result"}`);
    }
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

/** read the running chain at its head (or at an archived block) and build the settings that describe it */
export async function loadLive(dep: Deployment, url = dep.rpc, at?: number): Promise<LiveState> {
  const tag = at === undefined ? "latest" : `0x${at.toString(16)}`;
  const head = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [tag, false] })) as { result: { number: Hex; timestamp: Hex } };
  const blockHex = head.result.number;
  const block = Number(blockHex);
  const timestamp = Number(head.result.timestamp);
  const keys: VaultKey[] = ["eth", "btc"];
  const S = dep.subLoop;
  const named: [string, Call][] = [
    ["primePrice", { to: dep.oracle, sig: "function getAssetPrice(address) view returns (uint256)", args: [PRIME] }],
    ["account", { to: dep.aavePool, sig: "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)", args: [S] }],
    ["hollarReserve", { to: dep.aavePool, sig: "function getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)", args: [dep.hollar] }],
    ["primeConfig", { to: dep.aavePool, sig: "function getConfiguration(address) view returns (uint256)", args: [PRIME] }],
    ["targetHf", { to: S, sig: "function targetHf() view returns (uint256)" }],
    ["tranche", { to: S, sig: "function deployTranche() view returns (uint256)" }],
    ["admission", { to: S, sig: "function admissionMaxDeficitBps() view returns (uint16)" }],
    ["harvestThreshold", { to: S, sig: "function harvestThreshold() view returns (uint256)" }],
    ["costReservePpm", { to: S, sig: "function dcaSlippagePpm() view returns (uint32)" }],
    ["discount", { to: dep.discount, sig: "function discountBps() view returns (uint16)" }],
    ["loopDiscount", { to: dep.discount, sig: "function loopDiscountBps() view returns (uint16)", optional: true }],
    ["loopCap", { to: dep.discount, sig: "function loopCap() view returns (uint256)", optional: true }],
    ["poolHollar", { to: dep.hollar, sig: "function balanceOf(address) view returns (uint256)", args: [POOL143_EVM] }],
  ];
  for (const k of keys) {
    const asset = token(dep.assets[k]);
    const v = dep.vaults[k];
    named.push(
      [`${k}.price`, { to: dep.oracle, sig: "function getAssetPrice(address) view returns (uint256)", args: [asset], optional: !v }],
      [`${k}.config`, { to: dep.aavePool, sig: "function getConfiguration(address) view returns (uint256)", args: [asset], optional: !v }],
    );
    if (!v) continue;
    named.push(
      [`${k}.units`, { to: v.address, sig: "function totalAssets() view returns (uint256)" }],
      [`${k}.tvlCap`, { to: v.address, sig: "function tvlCap() view returns (uint256)" }],
      [`${k}.delay`, { to: v.address, sig: "function withdrawalDelay() view returns (uint32)" }],
      [`${k}.ledger`, { to: v.address, sig: "function mainDebt() view returns (address)" }],
      [`${k}.principal`, { to: S, sig: "function principalOf(address) view returns (uint256)", args: [v.address] }],
      [`${k}.equity`, { to: S, sig: "function equityOf(address) view returns (uint256)", args: [v.address] }],
      [`${k}.fee`, { to: dep.feeController, sig: "function protocolFeeBps(address) view returns (uint16)", args: [v.address] }],
      [`${k}.band`, { to: S, sig: "function rebalanceBand(address) view returns (uint16,uint16,uint16)", args: [v.address], optional: true }],
      [`${k}.headroom`, { to: S, sig: "function exitHeadroom(address) view returns (bool,uint16)", args: [v.address], optional: true }],
    );
  }
  const out = await ethCalls(url, named.map(([, c]) => c), blockHex);
  const r = new Map(named.map(([name], i) => [name, out[i]]));
  const deployed = keys.filter((k) => dep.vaults[k]);
  const ledgers = deployed.map((k) => r.get(`${k}.ledger`) as Hex);
  const ledgerOut = await ethCalls(url, ledgers.flatMap((l) => [
    { to: l, sig: "function activePosition() view returns (uint256,uint256,uint256)" },
    { to: l, sig: "function protocolReserve() view returns (uint256)", optional: true },
  ]), blockHex);
  deployed.forEach((k, i) => {
    r.set(`${k}.position`, ledgerOut[2 * i]);
    r.set(`${k}.reserve`, ledgerOut[2 * i + 1]);
  });
  // pool storage at the same block as the eth_calls (frontier blocks map 1:1 to substrate blocks); a batch may answer in any order
  const hashRes = ((await rpc(url, { jsonrpc: "2.0", id: 1, method: "chain_getBlockHash", params: [block] }).catch(() => null)) as { result?: unknown } | null)?.result;
  const at_ = typeof hashRes === "string" ? [hashRes] : [];
  const storage = new Map(((await rpc(url, [
    { jsonrpc: "2.0", id: 1, method: "state_getStorage", params: [POOL143_INFO_KEY, ...at_] },
    { jsonrpc: "2.0", id: 2, method: "state_getStorage", params: [POOL143_PRIME_KEY, ...at_] },
  ])) as { id: number; result: string | null }[]).map((x) => [x.id, x]));
  const info = storage.get(1);
  const primeRes = storage.get(2);
  const notes: string[] = [];

  // PRIME's yield over the last week from its oracle drift, or as much of it as the chain has, from a day on
  let primeYield: number | null = null;
  try {
    const back = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${Math.max(1, block - 20_000).toString(16)}`, false] })) as { result: { number: Hex; timestamp: Hex } };
    const secPerBlock = (timestamp - Number(back.result.timestamp)) / Math.max(1, block - Number(back.result.number));
    const weekAgo = Math.max(1, Math.round(block - (7 * 86400) / Math.max(1, secPerBlock)));
    const [past] = await ethCalls(url, [named[0][1]], `0x${weekAgo.toString(16)}`);
    const pastBlock = (await rpc(url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${weekAgo.toString(16)}`, false] })) as { result: { timestamp: Hex } };
    const years = (timestamp - Number(pastBlock.result.timestamp)) / (365 * 86400);
    const y = Math.log(n(r.get("primePrice"), 8) / n(past, 8)) / years;
    if (years > 1 / 365 && Number.isFinite(y) && y > -0.5 && y < 1) primeYield = y;
    else if (years <= 1 / 365) notes.push("PRIME yield kept: the chain has less than a day of oracle history");
  } catch {
    notes.push("PRIME yield kept: the node didn't serve last week's oracle price");
  }

  const acct = r.get("account") as bigint[];
  const hollarRes = r.get("hollarReserve") as bigint[];
  const cfg = (x: unknown) => ({ ltv: Number((x as bigint) & 0xffffn) / 1e4, lt: Number(((x as bigint) >> 16n) & 0xffffn) / 1e4 });
  const primeCfg = cfg(r.get("primeConfig"));
  const loopDiscount = r.get("loopDiscount");
  const loopCap = r.get("loopCap");
  const live = {
    primePrice: n(r.get("primePrice"), 8),
    collateralUsd: n(acct[0], 8),
    debtUsd: n(acct[1], 8),
    hf: n(acct[5], 18),
    hollarRate: n(hollarRes[4], 27),
    primeLt: primeCfg.lt,
    targetHf: n(r.get("targetHf"), 18),
    tranche: n(r.get("tranche"), 18),
    admission: Number(r.get("admission")),
    harvestThreshold: n(r.get("harvestThreshold"), 18),
    costReservePpm: Number(r.get("costReservePpm")),
    discount: Number(r.get("discount")) / 1e4,
    loopDiscount: loopDiscount === undefined ? undefined : Number(loopDiscount) / 1e4,
    loopCap: loopCap === undefined ? undefined : n(loopCap, 18),
    poolHollar: n(r.get("poolHollar"), 18),
    poolPrime: primeRes?.result ? Number(u128le(primeRes.result, 0)) / 1e6 : NaN,
    amp: info?.result ? uLe(info.result, 1 + 8 + 2, 2) : NaN,
    feeBps: info?.result ? uLe(info.result, 1 + 8 + 2 + 2 + 4 + 4, 4) / 100 : NaN,
  };
  const vaults = keys.map((k) => {
    const price = r.get(`${k}.price`);
    const c = r.get(`${k}.config`) === undefined ? undefined : cfg(r.get(`${k}.config`));
    if (!dep.vaults[k]) return { k, deployed: false as const, price: price === undefined ? undefined : n(price, 8), config: c };
    const band = r.get(`${k}.band`) as number[] | undefined;
    const headroom = r.get(`${k}.headroom`) as [boolean, number] | undefined;
    const reserve = r.get(`${k}.reserve`);
    return {
      k,
      deployed: true as const,
      price: n(price, 8),
      config: c!,
      units: n(r.get(`${k}.units`), 18),
      tvlCap: n(r.get(`${k}.tvlCap`), 18),
      cooldown: Number(r.get(`${k}.delay`)) / 3600,
      mainDebt: n((r.get(`${k}.position`) as bigint[])[0], 18),
      principal: n(r.get(`${k}.principal`), 18),
      equity: n(r.get(`${k}.equity`), 8),
      fee: Number(r.get(`${k}.fee`)),
      band: band && { gap: Number(band[0]) / 1e4, relever: Number(band[1]) / 1e4, delever: Number(band[2]) / 1e4 },
      headroom: headroom && { on: headroom[0], gapBps: Number(headroom[1]) },
      reserve: reserve === undefined ? undefined : n(reserve, 18),
    };
  });
  if (!Number.isFinite(live.poolPrime) || !Number.isFinite(live.amp)) notes.push("pool 143 storage unreadable; pool settings kept");
  const first = vaults.find((v) => v.deployed);
  if (!first) throw new Error(`${dep.label} has no vault`);
  // mid-ramp, the live HF says nothing about the lag
  const atTarget = live.hf >= live.targetHf && live.hf - live.targetHf <= 0.01;
  if (!atTarget) notes.push(`loop still ramping (HF ${live.hf.toFixed(3)} vs target ${live.targetHf.toFixed(3)}): HF lag kept`);
  for (const v of vaults) if (!v.deployed) notes.push(`no ${v.k === "eth" ? "jETH" : "jBTC"} vault on ${dep.label.split(" (")[0]}: its chain state is cleared and its toggle kept`);

  const changes: string[] = [];
  const apply = (input: Params): Params => {
    const p = structuredClone(input);
    const set = <T>(label: string, cur: T, next: T | undefined, write: (v: T) => void) => {
      if (next === undefined || (typeof next === "number" && !Number.isFinite(next))) return;
      if (cur !== next) changes.push(label);
      write(next);
    };
    changes.length = 0;
    set("PRIME price", p.market.primePrice, live.primePrice, (v) => { p.market.primePrice = v; });
    set("HOLLAR rate", p.market.hollarRate, live.hollarRate, (v) => { p.market.hollarRate = v; });
    if (primeYield != null) set("PRIME yield (7 d)", p.market.primeYield, primeYield, (v) => { p.market.primeYield = v; });
    set("target HF", p.loop.targetHf, live.targetHf, (v) => { p.loop.targetHf = v; });
    if (atTarget) set("HF lag", p.loop.hfLag, live.hf - live.targetHf, (v) => { p.loop.hfLag = v; });
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
    set("loop HOLLAR discount", p.fees.discountLoop, live.loopDiscount, (v) => { p.fees.discountLoop = v; });
    set("loop discount cap", p.fees.loopDiscountCapUsd, live.loopCap, (v) => { p.fees.loopDiscountCapUsd = v; });
    set("protocol fee", p.fees.protocolFeeBps, first.fee, (v) => { p.fees.protocolFeeBps = v; });
    set("withdrawal cooldown", p.policy.cooldownHours, first.cooldown, (v) => { p.policy.cooldownHours = v; });
    set("headroom exits", p.policy.headroomOn, first.headroom?.on, (v) => { p.policy.headroomOn = v; });
    set("headroom gap", p.policy.headroomGapBps, first.headroom?.gapBps, (v) => { p.policy.headroomGapBps = v; });
    set("protocol reserve", p.policy.reserveUsd, first.reserve, (v) => { p.policy.reserveUsd = v; });
    for (const v of vaults) {
      const pv = p.vaults[v.k];
      const name = pv.name;
      set(`${name} collateral price`, pv.price, v.price, (x) => { pv.price = x; });
      if (v.config) {
        // without a band from the chain, the band keeps its gaps off max LTV
        const shift = v.config.ltv - pv.maxLtv;
        set(`${name} max LTV`, pv.maxLtv, v.config.ltv, (x) => { pv.maxLtv = x; });
        set(`${name} LT`, pv.lt, v.config.lt, (x) => { pv.lt = x; });
        const band = v.deployed && v.band ? v.band : null;
        const target = band ? v.config.ltv - band.gap : pv.bandTarget + shift;
        const lo = band ? target - band.relever : pv.bandLo + shift;
        const hi = band ? target + band.delever : pv.bandHi + shift;
        const bp = (x: number) => Math.round(x * 1e4) / 1e4;
        set(`${name} band`, `${pv.bandLo}/${pv.bandTarget}/${pv.bandHi}`, `${bp(lo)}/${bp(target)}/${bp(hi)}`, () => {
          pv.bandLo = bp(lo);
          pv.bandTarget = bp(target);
          pv.bandHi = bp(hi);
        });
      }
      if (!v.deployed) {
        set(`${name} chain state`, pv.mainDebt + pv.loopPrincipal + pv.loopEquityUsd, 0, () => { pv.mainDebt = 0; pv.loopPrincipal = 0; pv.loopEquityUsd = 0; });
        continue;
      }
      set(`${name} on`, pv.on, true, (x) => { pv.on = x; });
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
