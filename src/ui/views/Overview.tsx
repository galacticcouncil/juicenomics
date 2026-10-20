import { useMemo } from "react";
import { evaluate, type ClosedResult, type VaultResult } from "../../engine/model/closedForm";
import type { Params } from "../../engine/params/types";
import { StackBar, Waterfall } from "../charts/Svg";
import { fmtBps, fmtDays, fmtPct, fmtUsd, fmtX } from "../fmt";

export function Tile({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="tile" title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Flags({ r, issues }: { r: ClosedResult; issues: string[] }) {
  const flags: { level: "critical" | "warning" | "good"; text: string }[] = issues.map((t) => ({ level: "critical", text: t }));
  for (const v of [r.vaults.eth, r.vaults.btc]) {
    if (v.net < 0) flags.push({ level: "critical", text: `${v.name} depositors lose money (${fmtPct(v.net)} a year)` });
    else if (v.net < 0.03) flags.push({ level: "warning", text: `${v.name} nets only ${fmtPct(v.net)} a year` });
  }
  if (r.rates.spread <= 0) flags.push({ level: "critical", text: "negative carry: PRIME yields less than HOLLAR costs" });
  if (r.breakEven.entryDays > 90) flags.push({ level: "warning", text: `entry break-even ${fmtDays(r.breakEven.entryDays)}` });
  if (r.lev.liqDrop < 0.04) flags.push({ level: "warning", text: `a ${fmtPct(r.lev.liqDrop, 1)} PRIME drop liquidates the loop` });
  if (!flags.length) flags.push({ level: "good", text: "no constraint is binding" });
  return (
    <div>
      {flags.map((f, i) => (
        <span key={i} className={`flag ${f.level}`}>
          <span className="ic">{f.level === "critical" ? "✕" : f.level === "warning" ? "!" : "✓"}</span>
          <span>{f.text}</span>
        </span>
      ))}
    </div>
  );
}

function VaultCard({ v, color }: { v: VaultResult; color: string }) {
  return (
    <div className="card">
      <h2>{v.name} <span className="muted small">{fmtUsd(v.tvlUsd)} TVL · per $1 of deposit, per year</span></h2>
      <Waterfall steps={v.waterfall} color={color} />
      <table className="grid">
        <tbody>
          <tr><td>net APR / APY</td><td className="num">{fmtPct(v.net)} / {fmtPct(v.netApy)}</td></tr>
          {v.inKind > 0 && <tr><td>with the collateral's own yield</td><td className="num">{fmtPct(v.netWithInKind)}</td></tr>}
          <tr><td>first year, paying your own entry + exit{v.depositFee ? " + deposit fee" : ""}</td><td className="num">{fmtPct(v.year1)}</td></tr>
          <tr><td>average LTV · rebalances / yr</td><td className="num">{fmtPct(v.avgLtv, 1)} · {v.bands.eventsPerYear.toFixed(0)}</td></tr>
          <tr><td>re-borrowed / repaid per yr (of TVL)</td><td className="num">{fmtPct(v.bands.releverPerYear, 0)} / {fmtPct(v.bands.deleverPerYear, 0)}</td></tr>
          <tr><td>one-off entry · exit cost (of deposit)</td><td className="num">{fmtPct(v.entryOneOff)} · {fmtPct(v.exitOneOff)}</td></tr>
          {v.firstCohortGrowthCost > 0 && <tr><td>first depositors pay for growth (pooled costs)</td><td className="num">{fmtPct(v.firstCohortGrowthCost)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const LEVS = [1.5, 2, 3, 4, 5, 6, 7, 8];

export function Overview({ p, r, issues, onApply }: { p: Params; r: ClosedResult; issues: string[]; onApply: (p: Params) => void }) {
  const levRows = useMemo(() => LEVS.map((L) => {
    const q = structuredClone(p);
    q.loop.mode = "lev";
    q.loop.leverage = L;
    return { L, q, r: evaluate(q) };
  }), [p]);
  const pr = r.protocol;
  const t = r.totals;
  const costs = r.vaults.eth.usd.churnCost + r.vaults.btc.usd.churnCost + r.vaults.eth.usd.flowCost + r.vaults.btc.usd.flowCost;
  return (
    <>
      <Flags r={r} issues={issues} />
      <div className="tiles">
        <Tile label="jETH net APR" value={fmtPct(r.vaults.eth.net)} sub={`APY ${fmtPct(r.vaults.eth.netApy)}${r.vaults.eth.inKind ? ` · ${fmtPct(r.vaults.eth.netWithInKind)} with GIGAETH yield` : ""}`} />
        <Tile label="jBTC net APR" value={fmtPct(r.vaults.btc.net)} sub={`APY ${fmtPct(r.vaults.btc.netApy)} · first year ${fmtPct(r.vaults.btc.year1)}`} />
        <Tile label="Break-even" value={fmtDays(r.breakEven.entryDays)} sub={`entry · round trip ${fmtDays(r.breakEven.roundTripDays)}`} title="days of carry to earn back the entry cost (and the exit)" />
        <Tile label="Leverage" value={fmtX(r.lev.L)} sub={`HF ${r.lev.hfEff.toFixed(3)} · liquidated by a ${fmtPct(r.lev.liqDrop, 1)} PRIME drop`} />
        <Tile label="Entry · unwind cost" value={`${r.costs.entryBps.toFixed(1)} · ${r.costs.unwindBps.toFixed(1)}`} sub={`bps vs oracle${r.costs.stall ? " · STALLS at the lane cap" : ""}${r.costs.deskCoverage ? ` · desk covers ${fmtPct(r.costs.deskCoverage, 0)}` : ""}`} />
        <Tile label="Deficit when ramped" value={fmtBps(r.deficit.structuralBps, 0)} sub={`gate ${r.deficit.stopsAt} bps · deposits close past ${fmtX(r.deficit.closeAtLeverage, 1)}`} />
        <Tile label="Protocol revenue / yr" value={fmtUsd(pr.total)} sub={`${fmtPct(t.tvlUsd ? pr.total / t.tvlUsd : 0, 1)} of TVL · ${fmtPct(pr.inCollateralShare, 0)} in collateral`} />
        <Tile label="Depositors earn / yr" value={fmtUsd(t.userNet)} sub={`${fmtPct(t.userAprWeighted)} on ${fmtUsd(t.tvlUsd)} TVL`} />
        <Tile label="Lark 4 hole now" value={fmtUsd(r.lark4Now.holeUsd)} sub={`${fmtBps(r.lark4Now.holeBps, 0)} at the oracle · ${fmtUsd(r.lark4Now.holeMarketUsd)} at HOLLAR's market price`} />
      </div>

      <div className="cards">
        <VaultCard v={r.vaults.eth} color="var(--series-1)" />
        <VaultCard v={r.vaults.btc} color="var(--series-2)" />
        <div className="card">
          <h2>Protocol revenue <span className="muted small">{fmtUsd(pr.total)} / yr</span></h2>
          <StackBar fmt={(v) => fmtUsd(v)} segments={[
            { label: "HOLLAR interest", value: pr.hollarInterest, color: "var(--series-1)" },
            { label: "fee in collateral", value: pr.collateralFee, color: "var(--series-2)" },
            { label: "pool 143 LP fees", value: pr.lpFees, color: "var(--series-3)" },
            { label: "deposit fees", value: pr.depositFees, color: "var(--series-4)" },
            { label: "desk spread", value: pr.deskSpread, color: "var(--series-7)" },
          ]} />
          {pr.incentiveCost > 0 && <p className="small muted">after paying {fmtUsd(pr.incentiveCost)} / yr of PRIME incentives</p>}
          <h3>Who gets the PRIME yield</h3>
          <StackBar fmt={(v) => fmtUsd(v)} segments={[
            { label: "depositors", value: Math.max(0, t.userNet), color: "var(--series-1)" },
            { label: "protocol (interest + fee)", value: pr.hollarInterest + pr.collateralFee, color: "var(--series-2)" },
            { label: "trading costs", value: costs, color: "var(--neutral)" },
          ]} />
          <table className="grid">
            <thead><tr><th>trading costs go to</th><th className="num">$ / yr</th></tr></thead>
            <tbody>
              <tr><td>outside arb, gross premium</td><td className="num">{fmtUsd(r.external.arbGross)}</td></tr>
              {r.external.arbOtherLeg > 0 && <tr><td>… of which its HOLLAR exit + bridging</td><td className="num">{fmtUsd(r.external.arbOtherLeg)}</td></tr>}
              <tr><td>pool 143 LPs (treasury)</td><td className="num">{fmtUsd(pr.lpFees)}</td></tr>
              <tr><td>ICE solver</td><td className="num">{fmtUsd(r.external.solver)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Entry cost, built up</h2>
          <table className="grid">
            <tbody>
              <tr><td>pool rests rich by the arb's threshold</td><td className="num">{fmtBps(r.costs.bandBps)}</td></tr>
              <tr><td>pool fee, paid twice (arb + loop)</td><td className="num">{fmtBps(2 * r.costs.feeBps)}</td></tr>
              <tr><td>price impact of one {fmtUsd(p.loop.tranche)} tranche</td><td className="num">{fmtBps(r.costs.impactBps, 2)}</td></tr>
              <tr><td>ICE solver</td><td className="num">{fmtBps(r.costs.solverBps)}</td></tr>
              <tr className="hi"><td>entry via outside arbs</td><td className="num">{fmtBps(r.costs.entryArbBps)}</td></tr>
              <tr><td>entry via the treasury desk</td><td className="num">{fmtBps(r.costs.entryDeskBps)}</td></tr>
              <tr className="hi"><td>used{p.costs.mode === "manual" ? " (manual)" : r.costs.deskCoverage ? ` (desk covers ${fmtPct(r.costs.deskCoverage, 0)})` : ""}</td><td className="num">{fmtBps(r.costs.entryBps)}</td></tr>
              <tr><td>unwind (arb · desk · used)</td><td className="num">{fmtBps(r.costs.unwindArbBps)} · {fmtBps(r.costs.unwindDeskBps)} · {fmtBps(r.costs.unwindBps)}</td></tr>
              {r.costs.arbOtherLegBps > 0 && <tr><td>arb's own costs (HOLLAR exit + bridging)</td><td className="num">{fmtBps(r.costs.arbOtherLegBps)}</td></tr>}
              <tr><td>lane cap</td><td className="num">{fmtBps(p.loop.laneCapBps, 0)}{r.costs.stall ? " — exceeded" : ""}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Leverage table <span className="muted small">click a row to use it</span></h2>
          <table className="grid">
            <thead><tr><th>leverage</th><th className="num">target HF</th><th className="num">jETH APR</th><th className="num">jBTC APR</th><th className="num">break-even</th><th className="num">deficit</th><th className="num">PRIME drop to liquidation</th><th className="num">protocol / yr</th></tr></thead>
            <tbody>
              {levRows.map(({ L, q, r: x }) => (
                <tr key={L} onClick={() => onApply(q)} style={{ cursor: "pointer" }} className={Math.abs(L - r.lev.L) < 0.25 ? "hi" : ""}>
                  <td>{fmtX(L, 1)}</td>
                  <td className="num">{x.lev.targetHf.toFixed(3)}</td>
                  <td className="num">{fmtPct(x.vaults.eth.net)}</td>
                  <td className="num">{fmtPct(x.vaults.btc.net)}</td>
                  <td className="num">{fmtDays(x.breakEven.entryDays)}</td>
                  <td className="num">{fmtBps(x.deficit.structuralBps, 0)}</td>
                  <td className="num">{fmtPct(x.lev.liqDrop, 1)}</td>
                  <td className="num">{fmtUsd(x.protocol.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
