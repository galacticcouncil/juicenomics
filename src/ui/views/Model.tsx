import type { ClosedResult } from "../../engine/model/closedForm";
import { SNAPSHOT } from "../../engine/params/defaults";
import type { Params } from "../../engine/params/types";
import { fmtPct, fmtX } from "../fmt";

export function Model({ p, r }: { p: Params; r: ClosedResult }) {
  const v = r.vaults.btc;
  return (
    <div className="cards">
      <div className="card">
        <h2>How the closed form works</h2>
        <p>Per $1 of deposited collateral, per year. Live values are jBTC under the current settings.</p>
        <div className="eq">{`leverage   L = 1 / (1 − LT / HF)                 = ${fmtX(r.lev.L)}   (LT ${p.loop.primeLt}, HF ${r.lev.hfEff.toFixed(3)})
spread     s = L·y − (L−1)·r_loop − r_vault     = ${fmtPct(r.rates.spread)} of principal
           y = PRIME yield + incentive          = ${fmtPct(r.rates.y)}
           r = HOLLAR rate × (1 − discount)     = ${fmtPct(r.rates.rLoop)} loop, ${fmtPct(r.rates.rMain)} vault
gross      ℓ̄ · s                                = ${fmtPct(v.gross)}   (ℓ̄ = average LTV ${fmtPct(v.avgLtv, 1)})
churn      N · L · [P_up·c·ℓ(1−e^−a) + P_down·u·ℓ(e^b−1)] = ${fmtPct(v.churn)}
           N = ${v.bands.eventsPerYear.toFixed(1)} rebalances / yr, P_up = ${fmtPct(v.bands.pRelever, 0)}
flows      L·ℓ·(inflow·c + outflow·u)  (pooled costs only) = ${fmtPct(v.flows)}
fee        f · max(0, ${p.fees.feeBase === "gross" ? "gross" : p.fees.feeBase === "yield" ? "gross − costs" : "gross + vault interest − costs"})              = ${fmtPct(v.feeTaken)}
net        gross − churn − flows − fee          = ${fmtPct(v.net)}
break-even 365 · c · L / s                      = ${r.breakEven.entryDays.toFixed(0)} days`}</div>
        <h3>Conventions</h3>
        <ul>
          <li>Entry cost c = arb threshold + 2 × pool fee + one tranche's impact + solver. With Lark's 15 bps arb this is 24.5 bps, as measured on Lark 4.</li>
          <li>Unwind cost u is fitted to the 16 Oct pool-143 sweep: a full unwind gains back part of the rich pool's premium.</li>
          <li>Rebalance churn comes from band geometry. The collateral's log price is a drifted Brownian motion that resets to target LTV when it leaves the band. The barriers are widened for discrete monitoring (Broadie–Glasserman–Kou). This matches the 20 Oct Monte Carlo within a few percent.</li>
          <li>Like the contracts, the protocol fee is taken on every harvest, including the slice that services the vault's HOLLAR interest, and after trading costs: in a deficit nothing is harvested, so no fee. "Yield after interest" and the study-style "fee on gross" are settings.</li>
          <li>Pooled cost attribution (today) spreads newcomers' entry costs and leavers' unwind costs over everyone. "Own" charges them to whoever causes them.</li>
          <li>Protocol revenue counts HOLLAR interest, which has no suppliers, so all of it goes to the protocol. It also counts the collateral fee, pool 143 fees (the treasury holds ~100% of the pool), deposit fees and the desk spread, less incentives.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Sources</h2>
        <ul>
          <li>Defaults: Lark 4 on chain at EVM block {SNAPSHOT.evmBlock} ({new Date(SNAPSHOT.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC). Refresh with <code>node scripts/snapshot-lark4.mjs</code>.</li>
          <li>Volatility: one year of mainnet AaveOracle prices, daily (tBTC 41%, ETH 57%). PRIME yield 5.93% is the oracle's drift since the 25 Sep fix.</li>
          <li>Arb thresholds (15 / 4 bps): 30 days of mainnet pool 143 history. HOLLAR exit costs: sdk-next quotes on 20 Oct.</li>
          <li>Study: garden <code>wiki/note-juicer-loop-cost-study-2026-10-20</code>.</li>
        </ul>
        <h3>Not modelled in the closed form</h3>
        <ul>
          <li>Path effects: arb inventory running dry, deposit stops, stalls, pool premium recapture between rebalances. Use the Simulation tab.</li>
          <li>Harvest and Main-interest servicing swaps are a flat cost per harvested dollar.</li>
          <li>Changes in the HOLLAR rate driven by utilisation.</li>
          <li>The execution-cost allowance: once the entry hole is repaid the loop keeps about allowance × L (≈ 160 bps of principal on Lark 4) as unharvested surplus. It cushions later costs and is held in USD, so in the Monte Carlo it lifts collateral-unit APR when collateral falls and trims it when collateral rises.</li>
        </ul>
      </div>
    </div>
  );
}
