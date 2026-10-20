// float64 mirror of Hydration's two-asset stableswap (math/src/stableswap/math.rs):
// reserves are scaled by their pegs, D and y follow the same Newton steps with ann = A·n,
// and the fee is taken from the output. index 0 = PRIME, 1 = HOLLAR; peg = HOLLAR per PRIME.

export interface PoolState {
  prime: number;
  hollar: number;
  peg: number;
  amp: number;
  fee: number;
}

const N = 2;

export function invariant(x0: number, x1: number, amp: number): number {
  const ann = amp * N;
  const s = x0 + x1;
  if (s === 0) return 0;
  let d = s;
  for (let i = 0; i < 64; i++) {
    const dp = (((d * d) / (x0 * N)) * d) / (x1 * N);
    const prev = d;
    d = ((ann * s + dp * N) * d) / ((ann - 1) * d + (N + 1) * dp);
    if (Math.abs(d - prev) <= 1e-12 * d) break;
  }
  return d;
}

function solveY(x: number, d: number, amp: number): number {
  const ann = amp * N;
  let c = (d * d) / (x * N);
  c = (c * d) / (ann * N);
  const b = x + d / ann;
  let y = d;
  for (let i = 0; i < 128; i++) {
    const prev = y;
    y = (y * y + c) / (2 * y + b - d);
    if (Math.abs(y - prev) <= 1e-12 * y) break;
  }
  return y;
}

/** amount out for selling `amountIn` of PRIME (side 0) or HOLLAR (side 1), after the fee */
export function quote(s: PoolState, side: 0 | 1, amountIn: number): number {
  if (amountIn <= 0) return 0;
  const xp = s.prime * s.peg;
  const xh = s.hollar;
  const d = invariant(xp, xh, s.amp);
  let out: number;
  if (side === 0) {
    const y = solveY(xp + amountIn * s.peg, d, s.amp);
    out = xh - y;
    if (!(y > 0)) return 0;
  } else {
    const y = solveY(xh + amountIn, d, s.amp);
    out = (xp - y) / s.peg;
    if (!(y > 0)) return 0;
  }
  // the pool can never pay out its whole reserve
  const reserve = side === 0 ? s.hollar : s.prime;
  if (!Number.isFinite(out) || out <= 0) return 0;
  return Math.min(out, reserve * 0.999) * (1 - s.fee);
}

export function apply(s: PoolState, side: 0 | 1, amountIn: number): number {
  const out = quote(s, side, amountIn);
  const gross = out / (1 - s.fee);
  if (side === 0) {
    s.prime += amountIn;
    s.hollar -= gross;
  } else {
    s.hollar += amountIn;
    s.prime -= gross / s.peg;
  }
  // the fee stays in the pool for its LPs
  if (side === 0) s.hollar += gross - out;
  else s.prime += (gross - out) / s.peg;
  return out;
}

/** shortfall vs the oracle in bps when selling `amountIn` (positive = worse than fair) */
export function shortfallBps(s: PoolState, side: 0 | 1, amountIn: number, oracle: number): number {
  const out = quote(s, side, amountIn);
  const fair = side === 0 ? amountIn * oracle : amountIn / oracle;
  return ((fair - out) / fair) * 1e4;
}

/** after-fee edge in bps a small probe earns vs the oracle (positive = profitable to sell `side`) */
export function edgeBps(s: PoolState, side: 0 | 1, oracle: number, probeUsd = 50): number {
  const amt = side === 0 ? probeUsd / oracle : probeUsd;
  return -shortfallBps(s, side, amt, oracle);
}
