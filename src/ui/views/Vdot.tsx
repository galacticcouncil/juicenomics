import { useMemo } from "react";
import quotes from "../../data/vdot-quotes.json";
import oracle from "../../data/vdot-oracle.json";
import { evaluateVdot, VDOT_DEFAULTS, VDOT_FIELDS, VDOT_MARKET, VDOT_SCOPE, type VdotParams } from "../../engine/model/vdot";
import { NumericField } from "../params/NumericField";
import { Waterfall } from "../charts/Svg";
import { fmtBps, fmtNum, fmtPct, fmtUsd, fmtX } from "../fmt";

export function Vdot({ p, onChange }: { p: VdotParams; onChange: (p: VdotParams) => void }) {
  const r = useMemo(() => evaluateVdot(p), [p]);
  const m = VDOT_MARKET;
  const seedQuote = quotes.quotes.find((q) => q.assetIn === 222 && q.amountIn === "75000")!;
  const token = (id: number) => ({ 5: "DOT", 15: "vDOT", 222: "HOLLAR", 1001: "aDOT" })[id] ?? String(id);
  const exportResult = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ params: p, result: r, snapshot: m, quotes, oracle, scope: VDOT_SCOPE }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "juicenomics-vdot-dot.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="strategies vdot-view">
    <div className="strategy-intro"><div>
      <h1>vDOT / DOT as the yield source</h1>
      <p>Main borrows HOLLAR → buy vDOT → supply vDOT → borrow DOT → buy more vDOT. Staking grows vDOT’s value in DOT; the loop pays DOT borrowing interest.</p>
      <p>This compares replacing the PRIME loop for <strong>new funding</strong>. The original vault collateral and HOLLAR Main debt stay the same. Existing capital is not actively reallocated.</p>
      <p><strong>Two loans:</strong> the vault/Main leg owes HOLLAR; the vDOT strategy owes DOT. This requires a source upgrade and a vDOT strategy. Making Main itself borrow DOT would require a different debt ledger and settlement design; the deployed ledger is fixed to HOLLAR.</p>
    </div><div className="controls"><button onClick={() => onChange({ ...VDOT_DEFAULTS })}>reset vDOT assumptions</button><button onClick={exportResult}>export vDOT results</button></div></div>
    <div className="banner" role="status" data-testid="vdot-status">
      <strong>{r.capacityExceeded ? "Requested target fails market or capacity checks." : "Market checks pass at the pinned snapshot; execution still needs validation."}</strong>{" "}
      Mainnet block {Number(m.block).toLocaleString("en-US")}, {new Date(Number(m.timestamp) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC. This is an analytical candidate; no vDOT strategy contracts are deployed by this preview.
      {r.assetsUSD > 0 && r.debtUSD / r.assetsUSD > r.maxLtv && <p><strong>Borrow limit:</strong> the requested loop LTV is {fmtPct(r.debtUSD / r.assetsUSD)}, above the {fmtPct(r.maxLtv, 0)} limit. New borrowing requires HF ≥ {fmtX(r.minimumBorrowableHf, 4)}. Carry below describes the theoretical target.</p>}
      <p><strong>Entry size matters:</strong> the pinned one-shot 75,000 HOLLAR → vDOT quote returns {fmtPct(seedQuote.costVsOracleBps / 1e4)} less USD value than its input at the oracle. The carry APR below excludes that cost. A paced ramp with refill needs separate simulation.</p>
    </div>
    <div className="strategy-layout">
      <aside className="strategy-settings" aria-label="vDOT settings">
        {(["Funding", "Price shock", "Oracle stress", "Capacity assumptions"] as const).map((group) => <details key={group} open={group === "Funding" || group === "Price shock"}>
          <summary>{group}</summary>
          {group === "Funding" && <label className="strategy-field toggle"><span><input type="checkbox" aria-label="DOT eMode" checked={p.useEMode} onChange={(e) => onChange({ ...p, useEMode: e.target.checked })} /> DOT eMode</span><small>{p.useEMode ? "85% max LTV / 92% liquidation threshold" : "60% max LTV / 70% liquidation threshold"}. Minimum borrowable HF: {fmtX(r.minimumBorrowableHf, 4)}.</small></label>}
          {VDOT_FIELDS.filter((f) => f.group === group).map((f) => <NumericField key={f.key} field={f} value={p[f.key]} onChange={(value) => onChange({ ...p, [f.key]: value })} />)}
        </details>)}
      </aside>
      <div className="strategy-results">
        <h2>Carry at flat DOT / USD</h2>
        <div className="tiles" aria-label="vDOT carry results">
          <div className="tile"><div className="label">{r.capacityExceeded ? "Theoretical carry APR" : "Depositor carry APR"}</div><div className="value" data-testid="vdot-apr">{fmtPct(r.depositorApr)}</div><div className="sub">{fmtUsd(r.depositorUSD)} / year before execution costs</div></div>
          <div className="tile"><div className="label">Monthly compounded APY</div><div className="value">{fmtPct(r.depositorMonthlyApy)}</div><div className="sub">constant carry, no DOT price change</div></div>
          <div className="tile"><div className="label">Protocol income / TVL</div><div className="value">{fmtPct(r.protocolIncomePerTvl)}</div><div className="sub">{fmtUsd(r.protocolUSD)} / year; not an APY</div></div>
          <div className="tile"><div className="label">Loop leverage / DOT borrow APR</div><div className="value">{fmtX(r.leverage)} / {fmtPct(r.dotBorrowRate)}</div><div className="sub">utilization after funding: {fmtPct(r.dotUtilization)}</div></div>
        </div>
        <div className="strategy-cards">
          <section className="card"><h2>Annual carry waterfall</h2><Waterfall steps={[
            { label: "vDOT income", value: (r.stakingIncomeUSD + r.supplyIncomeUSD) / p.tvl, kind: "start" },
            { label: "DOT interest", value: -r.loopInterestUSD / p.tvl, kind: "sub" },
            { label: "Harvest fee", value: -r.feeUSD / p.tvl, kind: "sub" },
            { label: "Main interest", value: -r.mainInterestUSD / p.tvl, kind: "sub" },
            { label: "Depositor", value: r.depositorApr, kind: "total" },
          ]} /><p className="small">vDOT supply interest adds {fmtUsd(r.supplyIncomeUSD)} / year. DOT borrowed by the loop receives no interest discount. Swap fees and price impact are excluded here and shown separately below.</p></section>
          <section className="card"><h2>Protocol income / year</h2><table className="grid"><tbody>
            <tr><td>Harvest fee</td><td className="num">{fmtUsd(r.feeUSD, false)}</td></tr>
            <tr><td>Paid Main HOLLAR interest</td><td className="num">{fmtUsd(r.mainInterestUSD, false)}</td></tr>
            <tr><td>DOT reserve-factor income (new debt)</td><td className="num">{fmtUsd(r.dotReserveIncomeUSD, false)}</td></tr>
            <tr className="hi"><td>Total</td><td className="num">{fmtUsd(r.protocolUSD, false)}</td></tr>
          </tbody></table><p className="small">The remaining DOT interest goes to reserve suppliers. The swap route’s aDOT belongs to pool participants; this strategy does not earn that lending yield. Income changes on existing borrowers are excluded.</p></section>
        </div>
        <section className="card"><h2>Compare with PRIME / HOLLAR</h2><div className="strategy-table"><table className="grid"><thead><tr><th>Same new TVL and fee</th><th className="num">vDOT / DOT</th><th className="num">PRIME / HOLLAR</th></tr></thead><tbody>
          <tr><td>Depositor carry APR</td><td className="num">{fmtPct(r.depositorApr)}</td><td className="num">{fmtPct(r.legacy.depositorApr)}</td></tr>
          <tr><td>Annual protocol income / TVL</td><td className="num">{fmtPct(r.protocolIncomePerTvl)}</td><td className="num">{fmtPct(r.legacy.protocolIncomePerTvl)}</td></tr>
          <tr><td>Total HOLLAR debt</td><td className="num">{fmtUsd(r.equityUSD)}</td><td className="num">{fmtUsd(r.legacy.hollarDebt)}</td></tr>
          <tr><td>Loop leverage</td><td className="num">{fmtX(r.leverage)}</td><td className="num">{fmtX(r.legacy.leverage)}</td></tr>
        </tbody></table></div><p className="small">Both use this snapshot and your Main discount. PRIME benchmark: HF 1.05, historical native growth 6.2% APR, 90% HOLLAR loop discount on up to $5m debt. vDOT uses the editable {fmtPct(p.stakingApr)} assumption. These theoretical targets omit execution costs and do not imply equal risk or capacity.</p></section>
        <section className="card"><h2>Harvest-fee comparison</h2><div className="strategy-table"><table className="grid"><thead><tr><th>Fee</th><th className="num">Depositor carry APR</th><th className="num">Protocol income / TVL</th></tr></thead><tbody>
          {[0, 0.22, 0.4, 0.69].map((fee) => { const c = evaluateVdot({ ...p, fee }); return <tr key={fee} className={p.fee === fee ? "hi" : ""}><td><button aria-pressed={p.fee === fee} onClick={() => onChange({ ...p, fee })}>{fmtPct(fee, 0)} fee</button></td><td className="num">{fmtPct(c.depositorApr)}</td><td className="num">{fmtPct(c.protocolIncomePerTvl)}</td></tr>; })}
        </tbody></table></div><p className="small">Depositor break-even harvest fee before execution costs: {r.breakEvenFee === null ? "no positive carry" : r.breakEvenFee < 0 ? "negative even at 0% fee" : fmtPct(r.breakEvenFee)}. This compares economics; it does not change governance settings.</p></section>
        <section className="card vdot-risk"><h2>DOT exposure and oracle HF</h2><p>The lending oracle prices vDOT as the Bifrost DOT-per-vDOT conversion rate × the same DOT/USD feed used for debt. Common DOT price changes and market trading discounts leave oracle HF unchanged. Debt growth or a change in the conversion-rate feed can still reduce HF; a market discount affects exit execution.</p><p>The source retains <strong>{fmtNum(r.netDotExposure)} DOT of net exposure</strong>, worth {fmtUsd(r.equityUSD)} initially, against a fixed HOLLAR obligation.</p>
          <div className="controls">{[-0.5, -0.3, 0, 0.3, 0.5].map((dotMove) => <button key={dotMove} aria-pressed={p.dotMove === dotMove && p.vdotMove === 0} onClick={() => onChange({ ...p, dotMove, vdotMove: 0 })}>{dotMove >= 0 ? "+" : ""}{fmtPct(dotMove, 0)} DOT</button>)}</div>
          <div className="tiles" aria-label="vDOT price shock results">
            <div className="tile"><div className="label">Oracle source P&amp;L / TVL</div><div className="value" data-testid="vdot-shock-pnl">{fmtPct(r.pricePnlPerTvl)}</div><div className="sub">{fmtUsd(r.pricePnlUSD)}, before harvesting fees</div></div>
            <div className="tile"><div className="label">Loop HF after shock</div><div className="value" data-testid="vdot-shock-hf">{r.stressedHf === null ? "no debt" : fmtX(r.stressedHf, 3)}</div><div className="sub">{r.liquidatable ? "below 1: liquidatable; recovery not modeled" : "instant oracle move, no keeper response"}</div></div>
            <div className="tile"><div className="label">Source funding coverage</div><div className="value">{r.stressedSourceCoverage === null ? "no funding" : fmtPct(r.stressedSourceCoverage)}</div><div className="sub">{fmtUsd(r.sourceShortfallUSD)} shortfall vs initial HOLLAR funding</div></div>
          </div>
          <p className="small">DOT move {fmtPct(p.dotMove)}; oracle conversion-rate change {fmtPct(p.vdotMove)}. Oracle stress changes the feed itself, not the market trading price. Original vault collateral is held fixed. These are instant oracle marks before interest, liquidation, exits or harvesting; they are not added to annual carry APR.</p>
        </section>
        <div className="strategy-cards">
          <section className="card"><h2>Full-ramp position and reserve</h2><table className="grid"><tbody>
            <tr><td>Main HOLLAR funding</td><td className="num">{fmtUsd(r.equityUSD)}</td></tr>
            <tr><td>vDOT collateral</td><td className="num">{fmtNum(r.assetsVdot)} / {fmtUsd(r.assetsUSD)}</td></tr>
            <tr><td>DOT loop debt</td><td className="num">{fmtNum(r.debtDOT)} / {fmtUsd(r.debtUSD)}</td></tr>
            <tr><td>DOT re-supplied by swaps</td><td className="num">{fmtNum(r.dotResupply)}</td></tr>
            <tr><td>DOT reserve cash remaining</td><td className="num">{fmtNum(r.dotCash)}</td></tr>
            <tr><td>Total DOT reserve debt</td><td className="num">{fmtNum(r.dotDebt)}</td></tr>
            <tr><td>Total vDOT supplied to Aave</td><td className="num">{fmtNum(r.vdotSupply)}</td></tr>
          </tbody></table><p className="small">The pinned swap route is DOT → aDOT → vDOT through Aave and pool 690. The re-supply assumption affects reserve cash and utilization; it is not an extra collateral position. Routing and pool balances can change during a real ramp.</p></section>
          <section className="card"><h2>Market and capacity checks</h2><ul className="strategy-checks">{r.checks.map((c) => <li key={c.label}><span className={c.ok ? "pass" : "fail"}>{c.ok ? "Pass at snapshot" : "Failed"}</span>{c.label}</li>)}</ul><p className="small">Candidate gross/net caps are assumptions. These checks do not establish HOLLAR mint headroom, deployed-source headroom, safe exit pacing or contract readiness. Requested targets are not clipped when a check fails.</p></section>
        </div>
        <section className="card"><h2>Pinned router quotes</h2><p>Pool 690 holds {fmtNum(r.poolVdot)} vDOT; the requested target needs {fmtNum(r.assetsVdot)}. These independent quotes use sdk-next {quotes.sdkVersion} at block {quotes.block}. They do not update when you change the scenario.</p>
          <div className="strategy-table"><table className="grid"><thead><tr><th>Input</th><th className="num">Output</th><th className="num">Cost vs oracle</th><th className="num">Route fee</th><th>Route</th></tr></thead><tbody>{quotes.quotes.map((q, i) => <tr key={i}>
            <td>{fmtNum(Number(q.amountIn))} {token(q.assetIn)}</td><td className="num">{fmtNum(Number(q.quote.amountOut))} {token(q.assetOut)}</td><td className="num">{fmtBps(q.costVsOracleBps)}</td><td className="num">{fmtPct(q.quote.tradeFeePct / 100)}</td><td>{q.quote.swaps.map((s) => `${token(s.assetIn)} → ${token(s.assetOut)} (${s.pool})`).join("; ")}</td>
          </tr>)}</tbody></table></div>
          <p className="small">The 75,000 HOLLAR and approximately 326,700 DOT quotes illustrate the original $100k reference at HF 1.15 and 5× leverage. Fee is included in quoted output: do not subtract it a second time. Cost vs oracle also includes market/oracle basis and price impact; a negative number means output exceeds the oracle mark. Quotes are not combined into a fabricated full-ramp cost. Large orders should be tested as sequential tranches with reserve and pool changes.</p>
        </section>
        <details className="card"><summary>Sources and assumptions</summary>
          <p>Oracle adapter and shared DOT/USD source verified on two RPCs at blocks {oracle.pinned.block} and {oracle.current.block}; the conversion-rate product matches the lending price with zero residual. The adapter uses Bifrost’s ten-minute conversion-rate feed, not pool 690’s trading price.</p>
          <p>vDOT native growth: {fmtPct(m.vdotGrowth.simpleAnnualizedApr, 4)} simple annualized APR from {m.vdotGrowth.elapsedSeconds / 86400} days, block {m.vdotGrowth.pastBlock} to {m.block}. DOT per vDOT increased from {Number(m.vdotGrowth.pastRate) / 1e8} to {Number(m.vdotGrowth.latestRate) / 1e8}. This is backward-looking, net exchange-rate growth; staking fees are not subtracted again.</p>
          <p>DOT rate curve: 0% base, 2.75% at 85% utilization, 49.5% at full utilization. DOT reserve factor 10%. vDOT lending interest responds to its additional supply. No incentive APR is included.</p>
          <pre className="eq">{`equity = new TVL × Main HOLLAR LTV\nleverage = HF / (HF − liquidation threshold)\nvDOT assets = equity × leverage; DOT debt = assets − equity\ncarry = assets × (vDOT growth + vDOT supply rate) − DOT debt × borrow rate\ndepositor = carry − max(0, carry) × fee − Main interest\nshock equity = (assets × (1 + oracle rate change) − debt) × (1 + DOT/USD move)`}</pre>
          <p>{VDOT_SCOPE}</p>
          <p>The snapshot’s reserve supplies and debts agree across two RPCs with zero residuals. The vDOT rate feed was {m.vdotGrowth.feedAgeSeconds} seconds old and the DOT/USD feed {m.reserves.DOT.round.ageSeconds} seconds old at that block. Source hash: <code className="strategy-hash">{m.hash}</code>.</p>
          <p><a href="https://docs.bifrost.io/faq/what-is-loopstake">Bifrost leveraged-staking mechanics</a> · <a href="https://docs.bifrost.io/faq/what-are-vtokens/vdot">vDOT exchange-rate mechanics</a> · <a href="https://github.com/galacticcouncil/sdk">Hydration routing SDK</a>. Quotes and raw market evidence are included in the export.</p>
        </details>
      </div>
    </div>
  </div>;
}
