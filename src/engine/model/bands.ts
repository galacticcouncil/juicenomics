// rebalance churn from band geometry: the collateral's log price is a drifted Brownian motion
// that resets to the target LTV whenever it leaves (relever on a rise of a, delever on a fall of b).
// barriers are widened by 0.5826·σ·√Δt for discrete monitoring (Broadie–Glasserman–Kou).

export interface BandInput {
  lo: number;
  target: number;
  hi: number;
  vol: number;
  drift: number;
  monitorYears: number;
}

export interface BandResult {
  a: number;
  b: number;
  eventsPerYear: number;
  pRelever: number;
  avgLtv: number;
  releverFrac: number;
  deleverFrac: number;
  releverPerYear: number;
  deleverPerYear: number;
}

const BETA = 0.5826;

export function bands(x: BandInput): BandResult {
  const { lo, target, hi, vol } = x;
  const a0 = Math.log(target / lo);
  const b0 = Math.log(hi / target);
  if (!(a0 > 0) || !(b0 > 0) || vol <= 0) {
    return { a: a0, b: b0, eventsPerYear: 0, pRelever: 0, avgLtv: target, releverFrac: 0, deleverFrac: 0, releverPerYear: 0, deleverPerYear: 0 };
  }
  const shift = BETA * vol * Math.sqrt(Math.max(0, x.monitorYears));
  const a = a0 + shift;
  const b = b0 + shift;
  const nu = x.drift - (vol * vol) / 2;
  const theta = (2 * nu) / (vol * vol);
  const small = Math.abs(theta) < 1e-9;
  const s = (z: number) => (small ? z : (1 - Math.exp(-theta * z)) / theta);
  const ds = (z: number) => (small ? 1 : Math.exp(-theta * z));
  const span = s(a) - s(-b);
  const pRelever = (s(0) - s(-b)) / span;
  // expected occupation density of the killed process started at 0
  const steps = 800;
  const h = (a + b) / steps;
  let time = 0;
  let ltvTime = 0;
  for (let i = 0; i <= steps; i++) {
    const y = -b + i * h;
    const g = (2 * (s(Math.min(0, y)) - s(-b)) * (s(a) - s(Math.max(0, y)))) / (span * vol * vol * ds(y));
    const w = i === 0 || i === steps ? 0.5 : 1;
    time += w * g * h;
    // log LTV moves opposite to the log price; the band is measured from the undetected levels
    ltvTime += w * g * h * target * Math.exp(-Math.max(-b0, Math.min(a0, y)));
  }
  const eventsPerYear = time > 0 ? 1 / time : 0;
  const avgLtv = time > 0 ? ltvTime / time : target;
  const releverFrac = target * (1 - Math.exp(-a));
  const deleverFrac = target * (Math.exp(b) - 1);
  return {
    a,
    b,
    eventsPerYear,
    pRelever,
    avgLtv,
    releverFrac,
    deleverFrac,
    releverPerYear: eventsPerYear * pRelever * releverFrac,
    deleverPerYear: eventsPerYear * (1 - pRelever) * deleverFrac,
  };
}
