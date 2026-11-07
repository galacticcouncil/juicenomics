// refresh src/data/<deployment>.json: node scripts/snapshot-lark.mjs <mainnet|lark4|lark0> [--block n] [--out file]
import { writeFileSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, formatUnits, http, keccak256, parseAbi } from "viem";
import { ApiPromise, HttpProvider, WsProvider } from "@polkadot/api";
import { blake2AsHex } from "@polkadot/util-crypto";

const POOL = "0x1b02E051683b5cfaC5929C25E84adb26ECf87B38";
const ORACLE = "0xAD33C0F0C42C5A0EAA65b5895D2BdB20cb6E8760";
const HOLLAR = "0x531a654d1696ED52e7275A8cede955E82620f99a";
const BAND = { relever: 6500, target: 7500, delever: 8300 };
const DEPLOYMENTS = {
  mainnet: {
    rpc: "https://hdx.tarn.hydration.cloud",
    genesis: "0xafdc188f45c71dacbaa0b62e16a91f726c7b8699a9748cdf715459de6b7f366d",
    source: "Hydration mainnet",
    subLoop: "0x2df1d70f413b5edd16bb794791117948a7436a45",
    fees: "0x9e9e273Df28b4f54a4B7227517fE56D7FFa24843",
    discount: "0x6a00bd956908bcCDbaC3523f862740AE9dE38550",
    vaults: [{ key: "eth", name: "jETH", collateral: "GIGAETH", assetId: 4200, address: "0x98db179d65b8abc53946bd89b3433a4fd3bfb60c" }],
    standIn: { key: "btc", name: "jBTC", collateral: "tBTC", assetId: 1000765, units: 0, tvlCap: 0, band: BAND },
  },
  lark4: {
    node: "node4",
    genesis: "0x6b320d1e88d14f43170286b3b4b4ed2dedc33e35b21bc6246388fae46f8ea564",
    source: "Lark 4 (refork 30 Oct 2026 from mainnet #16,394,393, genesis 0x6b32…a564)",
    subLoop: "0xe0983cedd797b38090e6dcde54af88aa6eb22edc",
    fees: "0xa64e418978482d5de91717cf6c77e1f40105f2ab",
    discount: "0x5bb401114feb59200e4e3ceace6fc5a7dea998fa",
    vaults: [{ key: "btc", name: "jBTC", collateral: "tBTC", assetId: 1000765, address: "0x79b41c78a2b5ac1ddc3c80877449b1cc8f850c46" }],
    // no jETH on this deployment: an opt-in vault on GIGAETH, sized like the 16 Oct Lark 4's, with the release's 65/75/83 band
    standIn: { key: "eth", name: "jETH", collateral: "GIGAETH", assetId: 4200, units: 23.0701090474847, tvlCap: 25, band: BAND },
  },
  lark0: {
    node: "node0",
    genesis: "0xa637c6bb6f61286b935b883bf5c6f9dbb00aa34054d0558952f9e7284e580a2a",
    source: "Lark 0 (refork 2 Nov 2026 from mainnet #16,544,945, genesis 0xa637…0a2a)",
    subLoop: "0x40cca3da6cead6dada9e9ffc4c06e9039791876a",
    fees: "0x5b153c8e24ca62436ef836a1f179dd8ade2d5acd",
    discount: "0x5f8d1d70c658fd0ffd79d3eaa692fc78306f39db",
    vaults: [{ key: "eth", name: "jETH", collateral: "GIGAETH", assetId: 4200, address: "0xa64e418978482d5de91717cf6c77e1f40105f2ab" }],
    // no jBTC on this deployment: an opt-in vault on tBTC, sized like Lark 4's 30 Oct jBTC, with the release's 65/75/83 band
    standIn: { key: "btc", name: "jBTC", collateral: "tBTC", assetId: 1000765, units: 1.867467104306708, tvlCap: 3, band: BAND },
  },
};

const args = process.argv.slice(2);
const key = args[0];
const dep = DEPLOYMENTS[key];
if (!dep) throw new Error(`usage: node scripts/snapshot-lark.mjs <${Object.keys(DEPLOYMENTS).join("|")}> [--block n] [--out file]`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : undefined;
};
const RPC = process.env.LARK_RPC ?? dep.rpc ?? `https://${dep.node}.lark.hydration.cloud`;
const WS = process.env.LARK_WS ?? `wss://${dep.node}.lark.hydration.cloud`;
const SUBLOOP = dep.subLoop;
const token = (id) => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, "0")}`;

const api = await ApiPromise.create({ provider: dep.rpc ? new HttpProvider(RPC) : new WsProvider(WS), noInitWarn: true });
const genesis = (await api.rpc.chain.getBlockHash(0)).toHex();
if (genesis !== dep.genesis) throw new Error(`unexpected genesis ${genesis}: not ${dep.source}`);

const pub = createPublicClient({ transport: http(RPC, { timeout: 60_000, retryCount: 3 }) });
const finalized = key === "mainnet" ? await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead()) : null;
const block = await pub.getBlock(opt("block") ? { blockNumber: BigInt(opt("block")) } : finalized ? { blockNumber: BigInt(finalized.number.toString()) } : {});
const at = { blockNumber: block.number };
const read = (address, sig, args = []) => {
  const abi = parseAbi([sig]);
  return pub.readContract({ address, abi, functionName: abi[0].name, args, ...at });
};
const u = (x, d) => Number(x) / 10 ** d;
const price = async (a) => u(await read(ORACLE, "function getAssetPrice(address) view returns (uint256)", [a]), 8);
const config = async (a) => {
  const c = await read(POOL, "function getConfiguration(address) view returns (uint256)", [a]);
  return { ltv: Number(c & 0xffffn) / 1e4, lt: Number((c >> 16n) & 0xffffn) / 1e4 };
};
const reserve = (a) => read(POOL, "function getReserveData(address) view returns ((uint256),uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)", [a]);

const account = await read(POOL, "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)", [SUBLOOP]);
const prime = token(43);
const [primePrice, primeCfg, hollarRes, primeRes] = await Promise.all([price(prime), config(prime), reserve(HOLLAR), reserve(prime)]);
const wad = (sig) => read(SUBLOOP, sig).then((x) => u(x, 18));
const loop = {
  collateralUsd: u(account[0], 8),
  debtUsd: u(account[1], 8),
  healthFactor: u(account[5], 18),
  principal: await wad("function principalEquity() view returns (uint256)"),
  equityUsd: u(await read(SUBLOOP, "function totalEquity() view returns (uint256)"), 8),
  targetHf: await wad("function targetHf() view returns (uint256)"),
  deployHfFloor: await wad("function deployHfFloor() view returns (uint256)"),
  deLeverTrigger: await wad("function deLeverTrigger() view returns (uint256)"),
  harvestThreshold: await wad("function harvestThreshold() view returns (uint256)"),
  deployTranche: await wad("function deployTranche() view returns (uint256)"),
  unwindTranche: u(await read(SUBLOOP, "function unwindTranche() view returns (uint256)"), 6),
  dcaSlippagePpm: Number(await read(SUBLOOP, "function dcaSlippagePpm() view returns (uint32)")),
  intentDriftBps: Number(await read(SUBLOOP, "function intentDriftBps() view returns (uint16)")),
  admissionMaxDeficitBps: Number(await read(SUBLOOP, "function admissionMaxDeficitBps() view returns (uint16)")),
};
const vaults = {};
for (const v of dep.vaults) {
  const t = token(v.assetId);
  const ledger = await read(v.address, "function mainDebt() view returns (address)");
  const position = await read(ledger, "function activePosition() view returns (uint256,uint256,uint256)");
  const [targetGap, relever, delever] = await read(SUBLOOP, "function rebalanceBand(address) view returns (uint16,uint16,uint16)", [v.address]);
  const [headroom, headroomGap] = await read(SUBLOOP, "function exitHeadroom(address) view returns (bool,uint16)", [v.address]);
  vaults[v.key] = {
    ...v,
    deployed: true,
    price: await price(t),
    ...(await config(t)),
    units: u(await read(v.address, "function totalAssets() view returns (uint256)"), 18),
    tvlCap: u(await read(v.address, "function tvlCap() view returns (uint256)"), 18),
    withdrawalDelay: Number(await read(v.address, "function withdrawalDelay() view returns (uint32)")),
    mainDebt: u(position[0], 18),
    loopPrincipal: u(await read(SUBLOOP, "function principalOf(address) view returns (uint256)", [v.address]), 18),
    loopEquityUsd: u(await read(SUBLOOP, "function equityOf(address) view returns (uint256)", [v.address]), 8),
    protocolFeeBps: Number(await read(dep.fees, "function protocolFeeBps(address) view returns (uint16)", [v.address])),
    band: { targetGap: Number(targetGap), relever: Number(relever), delever: Number(delever) },
    exitHeadroom: { enabled: headroom, gapBps: Number(headroomGap) },
    protocolReserve: u(await read(ledger, "function protocolReserve() view returns (uint256)"), 18),
  };
}
{
  const primary = vaults[dep.vaults[0].key];
  const t = token(dep.standIn.assetId);
  const c = await config(t);
  const max = Math.round(c.ltv * 1e4);
  const { band, ...rest } = dep.standIn;
  vaults[rest.key] = {
    ...rest,
    deployed: false,
    address: null,
    price: await price(t),
    ...c,
    withdrawalDelay: primary.withdrawalDelay,
    mainDebt: 0,
    loopPrincipal: 0,
    loopEquityUsd: 0,
    protocolFeeBps: primary.protocolFeeBps,
    band: { targetGap: max - band.target, relever: band.target - band.relever, delever: band.delever - band.target },
    exitHeadroom: primary.exitHeadroom,
    protocolReserve: 0,
  };
}

// the entry lane (HOLLAR → aPRIME): price cap, trade size, budget and pacing
const controller = await read(SUBLOOP, "function executionController() view returns (address)");
const lane = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [SUBLOOP, HOLLAR, primeRes[8]]));
const [group, , maximum] = await read(controller, "function limits(bytes32) view returns (bytes32,uint128,uint128)", [lane]);
const [, capacity, refill] = await read(controller, "function budgets(bytes32) view returns (address,uint128,uint128,uint128,uint64)", [group]);
const [interval] = await read(controller, "function pacing(bytes32) view returns (uint64,uint64,uint256)", [group]);
const execution = {
  laneCapBps: Number(await read(controller, "function maxShortfallBps(bytes32) view returns (uint16)", [lane])),
  trancheMax: Number(formatUnits(maximum, 18)),
  budgetCap: Number(formatUnits(capacity, 18)),
  refillPerSec: Number(formatUnits(refill, 18)),
  paceSec: Number(interval),
};

// pool storage at the same block as the eth_calls (frontier blocks map 1:1 to substrate blocks)
const hash = await api.rpc.chain.getBlockHash(Number(block.number));
const chain = await api.at(hash);
const pool = (await chain.query.stableswap.pools(143)).unwrap();
const pegs = (await chain.query.stableswap.poolPegs(143)).unwrap().toJSON();
const id = new Uint8Array(4); new DataView(id.buffer).setUint32(0, 143, true);
const acct = blake2AsHex(new Uint8Array([...new TextEncoder().encode("sts"), ...id]), 256);
const bal = async (a) => (await chain.call.currenciesApi.account(a, acct)).free.toString();
const pool143 = {
  feePpm: pool.fee.toNumber(),
  amp: Number(pool.finalAmplification.toString()),
  pegs: pegs.current.map(([n, d]) => [BigInt(n).toString(), BigInt(d).toString()]),
  prime: u(BigInt(await bal(43)), 6),
  hollar: u(BigInt(await bal(222)), 18),
};
await api.disconnect();

const [bucketCapacity, bucketLevel] = await read(HOLLAR, "function getFacilitatorBucket(address) view returns (uint256,uint256)", [hollarRes[8]]);
const snapshot = {
  source: dep.source,
  genesis: dep.genesis,
  evmBlock: Number(block.number),
  substrateBlock: Number(block.number),
  timestamp: Number(block.timestamp),
  prime: { price: primePrice, ...primeCfg, supplyApr: u(primeRes[2], 27) },
  hollar: { borrowApr: u(hollarRes[4], 27), headroom: u(bucketCapacity > bucketLevel ? bucketCapacity - bucketLevel : 0n, 18) },
  discount: {
    mainBps: Number(await read(dep.discount, "function discountBps() view returns (uint16)")),
    loopBps: Number(await read(dep.discount, "function loopDiscountBps() view returns (uint16)")),
    loopCap: u(await read(dep.discount, "function loopCap() view returns (uint256)"), 18),
  },
  loop,
  vaults,
  pool143,
  execution,
};
const out = opt("out") ?? new URL(`../src/data/${key}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(JSON.stringify({ deployment: key, evmBlock: snapshot.evmBlock, loop: snapshot.loop.collateralUsd, units: Object.fromEntries(dep.vaults.map((v) => [v.key, vaults[v.key].units])), pool: snapshot.pool143, execution }));
process.exit(0);
