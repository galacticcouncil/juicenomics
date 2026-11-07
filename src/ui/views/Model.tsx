import type { ClosedResult } from "../../engine/model/closedForm";
import { DEPLOYMENT, SNAPSHOTS } from "../../engine/params/defaults";
import type { DeploymentKey, Params } from "../../engine/params/types";
import { fmtPct, fmtX } from "../fmt";

const RUNS: Record<DeploymentKey, string> = {
  mainnet: "jETH on GIGAETH, with a 7-day withdrawal delay",
  lark4: "jBTC alone, money-market #89 contracts",
  lark0: "jETH alone on GIGAETH, launched 2–3 Nov through the mainnet launch path, with a 60 s withdrawal delay",
};
const STAND_IN: Record<DeploymentKey, string> = {
  mainnet: "jBTC is off: mainnet runs jETH only. Enabling jBTC models a hypothetical vault; it has no deployed position.",
  lark4: "jETH is off: Lark 4 runs no jETH vault. Switched on, it's a GIGAETH vault sized like the 16 Oct Lark 4's, with the same band and fees and no debt yet.",
  lark0: "jBTC is off: Lark 0 runs no jBTC vault. Switched on, it's a tBTC vault sized like Lark 4's 30 Oct jBTC, with the same band and fees and no debt yet.",
};

export function Model({ p, r }: { p: Params; r: ClosedResult }) {
  const v = r.vaults[r.active[r.active.length - 1] ?? "btc"];
  const snap = SNAPSHOTS[p.deployment];
  return (
    <div className="cards">
      <div className="card">
        <h2>How the closed form works</h2>
        <p>Per $1 of deposited collateral, per year. Live values are {v.name} under the current settings.</p>
        <div className="eq">{`leverage   L = 1 / (1 − LT / HF)                 = ${fmtX(r.lev.L)}   (LT ${p.loop.primeLt}, HF ${r.lev.hfEff.toFixed(3)})
spread     s = L·y − (L−1)·r_loop − r_vault     = ${fmtPct(r.rates.spread)} of principal
           y = PRIME yield + incentive          = ${fmtPct(r.rates.y)}
           r = HOLLAR rate × (1 − discount)     = ${fmtPct(r.rates.rLoop)} loop, ${fmtPct(r.rates.rMain)} vault
               the loop's discount covers min(debt, cap): ${fmtPct(r.rates.loopDiscounted, 0)} of it
gross      ℓ̄ · s                                = ${fmtPct(v.gross)}   (ℓ̄ = average LTV ${fmtPct(v.avgLtv, 1)})
churn      N · L · [P_up·c·ℓ(1−e^−a) + P_down·u·ℓ(e^b−1)] = ${fmtPct(v.churn)}
           N = ${v.bands.eventsPerYear.toFixed(1)} rebalances / yr, P_up = ${fmtPct(v.bands.pRelever, 0)}
flows      L·ℓ·(inflow·c + outflow·(1−h)·u)  (pooled costs only) = ${fmtPct(v.flows)}
           h = exits settled from headroom      = ${p.policy.headroomOn ? fmtPct(v.headroom.share, 0) : "off"}
fee        f · max(0, ${p.fees.feeBase === "gross" ? "gross" : p.fees.feeBase === "yield" ? "gross − costs" : "gross + vault interest − costs"})              = ${fmtPct(v.feeTaken)}
net        gross − churn − flows − fee          = ${fmtPct(v.net)}
break-even 365 · (c·L·ℓ·(1−f) + deposit fee) / net  = ${Number.isFinite(v.breakEvenDays) ? `${v.breakEvenDays.toFixed(0)} days` : "never (net ≤ 0)"}
deficit    365 · c · L / s, before fees        = ${Number.isFinite(r.breakEven.holeDays) ? `${r.breakEven.holeDays.toFixed(0)} days` : "never"}`}</div>
        <h3>Conventions</h3>
        <ul>
          <li>Entry cost c = arb threshold + 2 × pool fee + one tranche's impact + solver. With the 15 bps arb and the Larks' 1 bp pool fee this is 18.5 bps. At mainnet's 4 bps it's 24.5, as measured on the 16 Oct Lark 4; a 30 Oct jBTC deposit ramped for 104 bps of principal against the model's 111.</li>
          <li>Unwind cost u is fitted to the 16 Oct pool-143 sweep: a full unwind gains back part of the rich pool's premium.</li>
          <li>Bands come from SubLoop.rebalanceBand, per vault, as gaps off the collateral's max LTV: Lark 4's jBTC and Lark 0's jETH both target 5% under an 80% max LTV, relever below 65% and delever above 83%.</li>
          <li>Rebalance churn comes from band geometry. The collateral's log price is a drifted Brownian motion that resets to target LTV when it leaves the band. The barriers are widened for discrete monitoring (Broadie–Glasserman–Kou). This matches the 20 Oct Monte Carlo within a few percent.</li>
          <li>A deposit's entry and an exit's unwind are repaid from carry before any fee, so on the contracts' fee base the protocol's share bears its part: a depositor's one-offs and break-even count (1 − f) of them.</li>
          <li>Headroom exits (SubLoop.setExitHeadroom): an exit settles without selling the loop when the vault's whole debt, against the collateral left after it, stays at or under max LTV less the gap. The holders who stay keep its loop slice and the Main debt it backs; only a surplus over that debt unwinds, and a shortfall is the protocol reserve's, if it covers it with the debt still queued. Their LTV rises, so later delevers sell part of what was spared. The closed form drifts the band's LTV up by the exits it serves, against deposits and reinvested carry, and counts the share of time an exit of each size (dollar-weighted lognormal) still fits.</li>
          <li>Like the contracts, the protocol fee is taken on every harvest, including the slice that services the vault's HOLLAR interest, and after trading costs: in a deficit nothing is harvested, so no fee. "Yield after interest" and the study-style "fee on gross" are settings.</li>
          <li>Pooled cost attribution (today) spreads newcomers' entry costs and leavers' unwind costs over everyone. "Own" charges them to whoever causes them.</li>
          <li>Newcomers mint vault shares at the collateral's value (pooled, as on chain), so they also take a slice of whatever surplus or hole the loop holds when they enter. The closed form leaves a vault's share of the loop with its incumbents.</li>
          <li>Growth: each vault's TVL is grown over the horizon at today's prices, with inflows, growth, withdrawals and the cap. An incumbent pays newcomers' pooled entries in proportion to the TVL at the time, i.e. the time average of inflow / TVL (ln g a year for g× exponential growth, not g − 1); dollar figures use the average TVL. The Monte Carlo grows TVL in dollars, so falling prices slow it.</li>
          <li>Start: a new visit loads mainnet's current positions. Shared scenarios keep their saved starting state. A fresh start pays the whole ramp (≈ c · L · ℓ of TVL) inside the horizon; current state carries forward the chain's supplied collateral, debt and waiting cash.</li>
          <li>Protocol revenue counts HOLLAR interest, which has no suppliers, so all of it goes to the protocol. It also counts the collateral fee, pool 143 fees (the treasury holds ~100% of the pool), deposit fees and the desk spread, less incentives.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Sources</h2>
        <ul>
          <li>{DEPLOYMENT[p.deployment].name} settings: {snap.source}, on chain at EVM block {snap.evmBlock} ({new Date(snap.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC): {RUNS[p.deployment]}. Refresh with <code>node scripts/snapshot-lark.mjs {p.deployment}</code>.</li>
          <li>{STAND_IN[p.deployment]}</li>
          <li>GIGAETH is pool 4200's share (aETH and wstETH). Its oracle is ETH/USD times the pool's share rate, so it moves with ETH and gained 1.5% on it over the last year of mainnet oracles. That gain is the collateral's own yield: APRs in GIGAETH leave it out.</li>
          <li>Volatility: one year of mainnet AaveOracle prices, daily (tBTC 41%, ETH 57%). PRIME yield 5.93% is the oracle's drift since the 25 Sep fix.</li>
          <li>Arb thresholds (15 / 4 bps): 30 days of mainnet pool 143 history. HOLLAR exit costs: sdk-next quotes on 20 Oct.</li>
          <li>Study: garden <code>wiki/note-juicer-loop-cost-study-2026-10-20</code>.</li>
        </ul>
        <h3>Not modelled in the closed form</h3>
        <ul>
          <li>Path effects: arb inventory running dry, deposit stops, stalls, pool premium recapture between rebalances. Use the Simulation tab.</li>
          <li>Harvest and Main-interest servicing swaps are a flat cost per harvested dollar, the same for tBTC and GIGAETH.</li>
          <li>Buying and selling the collateral itself, outside the vault: for GIGAETH that's pool 4200, where Lark 0's $100k depositor paid about 1.4 bps over the oracle, buying with ETH.</li>
          <li>Changes in the HOLLAR rate driven by utilisation.</li>
          <li>The execution-cost allowance: once the entry hole is repaid the loop keeps about allowance × L (≈ {(p.policy.costReserveBps * r.lev.L).toFixed(0)} bps of principal here) as unharvested surplus. It cushions later costs. The Monte Carlo values a share at what an exit would return, net of the fee on that surplus; its leveraged carry still adds about 0.15 pp of APR at a flat median price on Lark 4, 0.3 on Lark 0's larger allowance. Held in USD, it adds more when collateral falls and less when it rises.</li>
          <li>The protocol reserve: it limits headroom exits with a shortfall, which the Monte Carlo models; a fully ramped loop rarely has one.</li>
        </ul>
      </div>
    </div>
  );
}
