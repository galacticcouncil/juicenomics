import { apply as fastApply, quote as fastQuote, type PoolState } from "./fastPool";

/** pool 143 as the simulation sees it; side 0 sells PRIME, side 1 sells HOLLAR */
export interface Pool {
  state: PoolState;
  quote: (side: 0 | 1, amountIn: number) => number;
  apply: (side: 0 | 1, amountIn: number) => number;
}

export function fastPool(state: PoolState): Pool {
  return {
    state,
    quote: (side, a) => fastQuote(state, side, a),
    apply: (side, a) => fastApply(state, side, a),
  };
}

export interface StableswapWasm {
  calculate_out_given_in: (reserves: string, assetIn: number, assetOut: number, amountIn: string, amp: string, fee: string, pegs: string) => string;
}

const PRIME = 43;
const HOLLAR = 222;
const E6 = 1e6;
const E18 = 1e18;

const big = (x: number, scale: number) => BigInt(Math.max(0, Math.floor(x * scale))).toString();

/** Hydration's own stableswap math (wasm), with float bookkeeping between calls */
export function wasmPool(state: PoolState, math: StableswapWasm): Pool {
  const quote = (side: 0 | 1, a: number) => {
    if (a <= 0) return 0;
    const reserves = JSON.stringify([
      { asset_id: PRIME, decimals: 6, amount: big(state.prime, E6) },
      { asset_id: HOLLAR, decimals: 18, amount: big(state.hollar, E18) },
    ]);
    const pegs = JSON.stringify([[big(state.peg, E18), big(1, E18)], ["1", "1"]]);
    const out = math.calculate_out_given_in(
      reserves,
      side === 0 ? PRIME : HOLLAR,
      side === 0 ? HOLLAR : PRIME,
      side === 0 ? big(a, E6) : big(a, E18),
      String(Math.round(state.amp)),
      String(state.fee),
      pegs,
    );
    const n = Number(out);
    return Number.isFinite(n) ? n / (side === 0 ? E18 : E6) : 0;
  };
  return {
    state,
    quote,
    apply: (side, a) => {
      const out = quote(side, a);
      if (side === 0) {
        state.prime += a;
        state.hollar -= out;
      } else {
        state.hollar += a;
        state.prime -= out;
      }
      return out;
    },
  };
}
