// refresh src/data/lark4.json from the live Lark 4 chain (read-only)
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { blake2AsHex } from "@polkadot/util-crypto";

const RPC = process.env.LARK_RPC ?? "https://node4.lark.hydration.cloud";
const WS = process.env.LARK_WS ?? "wss://node4.lark.hydration.cloud";
const GENESIS = "0x6b320d1e88d14f43170286b3b4b4ed2dedc33e35b21bc6246388fae46f8ea564";
const SUBLOOP = "0xe0983cedd797b38090e6dcde54af88aa6eb22edc";
const POOL = "0x1b02E051683b5cfaC5929C25E84adb26ECf87B38";
const ORACLE = "0xAD33C0F0C42C5A0EAA65b5895D2BdB20cb6E8760";
const FEES = "0xa64e418978482d5de91717cf6c77e1f40105f2ab";
const DISCOUNT = "0x5bb401114feb59200e4e3ceace6fc5a7dea998fa";
const HOLLAR = "0x531a654d1696ED52e7275A8cede955E82620f99a";
const token = (id) => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, "0")}`;
const VAULTS = [
  { key: "btc", name: "jBTC", collateral: "tBTC", assetId: 1000765, address: "0x79b41c78a2b5ac1ddc3c80877449b1cc8f850c46" },
];
// no jETH on this deployment: an opt-in vault on GIGAETH, sized like the 16 Oct Lark 4's, with the release's 65/75/83 band
const JETH = { key: "eth", name: "jETH", collateral: "GIGAETH", assetId: 4200, units: 23.0701090474847, tvlCap: 25, band: { relever: 6500, target: 7500, delever: 8300 } };

const pub = createPublicClient({ transport: http(RPC, { timeout: 60_000, retryCount: 3 }) });
const block = await pub.getBlock();
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
for (const v of VAULTS) {
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
    protocolFeeBps: Number(await read(FEES, "function protocolFeeBps(address) view returns (uint16)", [v.address])),
    band: { targetGap: Number(targetGap), relever: Number(relever), delever: Number(delever) },
    exitHeadroom: { enabled: headroom, gapBps: Number(headroomGap) },
    protocolReserve: u(await read(ledger, "function protocolReserve() view returns (uint256)"), 18),
  };
}
{
  const t = token(JETH.assetId);
  const c = await config(t);
  const max = Math.round(c.ltv * 1e4);
  const { band, ...rest } = JETH;
  vaults.eth = {
    ...rest,
    deployed: false,
    address: null,
    price: await price(t),
    ...c,
    withdrawalDelay: vaults.btc.withdrawalDelay,
    mainDebt: 0,
    loopPrincipal: 0,
    loopEquityUsd: 0,
    protocolFeeBps: vaults.btc.protocolFeeBps,
    band: { targetGap: max - band.target, relever: band.target - band.relever, delever: band.delever - band.target },
    exitHeadroom: vaults.btc.exitHeadroom,
    protocolReserve: 0,
  };
}

const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
const genesis = (await api.rpc.chain.getBlockHash(0)).toHex();
if (genesis !== GENESIS) throw new Error(`unexpected genesis ${genesis}: not the 30 Oct Lark 4`);
const head = await api.rpc.chain.getHeader();
const pool = (await api.query.stableswap.pools(143)).unwrap();
const pegs = (await api.query.stableswap.poolPegs(143)).unwrap().toJSON();
const id = new Uint8Array(4); new DataView(id.buffer).setUint32(0, 143, true);
const acct = blake2AsHex(new Uint8Array([...new TextEncoder().encode("sts"), ...id]), 256);
const bal = async (a) => (await api.call.currenciesApi.account(a, acct)).free.toString();
const pool143 = {
  feePpm: pool.fee.toNumber(),
  amp: Number(pool.finalAmplification.toString()),
  pegs: pegs.current.map(([n, d]) => [BigInt(n).toString(), BigInt(d).toString()]),
  prime: u(BigInt(await bal(43)), 6),
  hollar: u(BigInt(await bal(222)), 18),
};
await api.disconnect();

const snapshot = {
  source: "Lark 4 (refork 30 Oct 2026 from mainnet #16,394,393, genesis 0x6b32…a564)",
  genesis: GENESIS,
  evmBlock: Number(block.number),
  substrateBlock: head.number.toNumber(),
  timestamp: Number(block.timestamp),
  prime: { price: primePrice, ...primeCfg, supplyApr: u(primeRes[2], 27) },
  hollar: { borrowApr: u(hollarRes[4], 27) },
  discount: {
    mainBps: Number(await read(DISCOUNT, "function discountBps() view returns (uint16)")),
    loopBps: Number(await read(DISCOUNT, "function loopDiscountBps() view returns (uint16)")),
    loopCap: u(await read(DISCOUNT, "function loopCap() view returns (uint256)"), 18),
  },
  loop,
  vaults,
  pool143,
};
writeFileSync(new URL("../src/data/lark4.json", import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
console.log(JSON.stringify({ evmBlock: snapshot.evmBlock, loop: snapshot.loop.collateralUsd, btc: snapshot.vaults.btc.units, pool: snapshot.pool143 }));
process.exit(0);
