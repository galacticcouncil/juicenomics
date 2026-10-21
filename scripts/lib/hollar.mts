// read-only snapshot of HOLLAR's supply side: total supply, facilitator buckets, HSM inventory
import { ApiPromise, WsProvider } from "@polkadot/api";
import { createPublicClient, http, parseAbi } from "viem";

const HOLLAR = "0x531a654d1696ed52e7275a8cede955e82620f99a";
// facilitators recorded in garden wiki/hollar.md; the HSM is pallet account py/hsmod
const FACILITATORS = {
  market: "0x8c0f3b9602374198974d2b2679d14a386f5b108e",
  flashMinter: "0xb3282db2fb01a9305b753ecca09bf68c45428cf4",
  hsm: "0x6d6f646c70792f68736d6f640000000000000000",
  gigahdx: "0x116d7bb8e4e2a4c932b4d36c115d4122dc360462",
  bil: "0xef313c2baf19ce58eeb6df9c82ae41c7387afe3e",
} as const;
const HSM_ACCOUNT = "0x6d6f646c70792f68736d6f640000000000000000000000000000000000000000";

export async function hollarState(evmUrl: string, wsUrl: string) {
  const c = createPublicClient({ transport: http(evmUrl, { batch: true, timeout: 30_000 }) });
  const abi = parseAbi(["function totalSupply() view returns (uint256)", "function getFacilitatorBucket(address) view returns (uint256,uint256)"]);
  const block = Number(await c.getBlockNumber());
  const supply = Number(await c.readContract({ address: HOLLAR, abi, functionName: "totalSupply" })) / 1e18;
  const buckets: Record<string, { capacity: number; level: number; headroom: number }> = {};
  for (const [k, address] of Object.entries(FACILITATORS)) {
    const [cap, lvl] = (await c.readContract({ address: HOLLAR, abi, functionName: "getFacilitatorBucket", args: [address as `0x${string}`] })) as [bigint, bigint];
    buckets[k] = { capacity: Number(cap) / 1e18, level: Number(lvl) / 1e18, headroom: (Number(cap) - Number(lvl)) / 1e18 };
  }
  const api = await ApiPromise.create({ provider: new WsProvider(wsUrl), noInitWarn: true });
  try {
    const hsm = [];
    for (const [key, val] of await api.query.hsm.collaterals.entries()) {
      const asset = Number(key.args[0].toString());
      const info = val.toJSON() as { poolId?: number; maxInHolding?: string | number; buyBackRate?: unknown; maxBuyPriceCoefficient?: string };
      const meta = (await api.query.assetRegistry.assets(asset)).toJSON() as { decimals?: number; symbol?: string } | null;
      const acc = (await api.query.tokens.accounts(HSM_ACCOUNT, asset)).toJSON() as { free?: string | number } | null;
      const dec = Number(meta?.decimals ?? 18);
      const symbol = typeof meta?.symbol === "string" && meta.symbol.startsWith("0x") ? Buffer.from(meta.symbol.slice(2), "hex").toString() : String(meta?.symbol ?? asset);
      hsm.push({
        asset, symbol, pool: info?.poolId,
        heldUnits: Number(BigInt(acc?.free ?? 0)) / 10 ** dec,
        maxInHolding: Number(BigInt(info?.maxInHolding ?? 0)) / 10 ** dec,
        maxBuyPrice: info?.maxBuyPriceCoefficient ? Number(BigInt(info.maxBuyPriceCoefficient)) / 1e18 : undefined,
        buyBackRate: info?.buyBackRate,
      });
    }
    return { evmBlock: block, hollarSupply: supply, facilitators: buckets, hsm };
  } finally {
    await api.disconnect();
  }
}
