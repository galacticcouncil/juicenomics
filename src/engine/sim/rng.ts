// sfc32 seeded by splitmix32, so path i gets the same numbers however paths are split across workers

function splitmix32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0);
  };
}

export interface Rng {
  next: () => number;
  normal: () => number;
  int: (n: number) => number;
}

export function rng(seed: number, path: number): Rng {
  const sm = splitmix32((seed * 0x9e3779b1) ^ (path * 0x85ebca6b));
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  let spare: number | null = null;
  const normal = () => {
    if (spare != null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u <= 1e-12) u = next();
    v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, normal, int: (n) => Math.floor(next() * n) };
}

/** Knuth for small means, normal approximation above */
export function poisson(r: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * r.normal()));
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r.next();
  } while (p > l);
  return k - 1;
}
