import { useMemo } from "react";
import legacyQuotes from "../../data/vdot-quotes.json";
import dotQuotes from "../../data/vdot-dot-quotes.json";
import funding from "../../data/vdot-funding.json";
import oracle from "../../data/vdot-oracle.json";
import { evaluateVdot, VDOT_DEFAULTS, VDOT_FIELDS, VDOT_MARKET, VDOT_SCOPE, type VdotParams } from "../../engine/model/vdot";
import { NumericField } from "../params/NumericField";
import { Waterfall } from "../charts/Svg";
import { fmtBps, fmtNum, fmtPct, fmtUsd, fmtX } from "../fmt";

export function Vdot({ p, onChange }: { p: VdotParams; onChange: (p: VdotParams) => void }) {
  const r = useMemo(() => evaluateVdot(p), [p]);
  const m = VDOT_MARKET;
  const dotFunding = p.fundingAsset === "DOT";
  const quotes = dotFunding ? dotQuotes : legacyQuotes;
  const seedQuote = dotFunding ? dotQuotes.quotes.find((q) => q.role === "funding")! : legacyQuotes.quotes.find((q) => q.assetIn === 222 && q.amountIn === "75000")!;
  const token = (id: number) => ({ 5: "DOT", 15: "vDOT", 222: "HOLLAR", 1001: "aDOT" })[id] ?? String(id);
  const exportResult = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ params: p, result: r, snapshot: m, quotes, oracle, funding, scope: VDOT_SCOPE }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "juicenomics-vdot-dot.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="strategies vdot-view">
    <div className="strategy-intro"><div>
      <h1>vDOT / DOT as the yield source</h1>
      <p>{dotFunding ? "Original vault collateral → borrow DOT → buy vDOT → supply vDOT → borrow more DOT." : "Main borrows HOLLAR → buy vDOT → supply vDOT → borrow DOT → buy more vDOT."} Staking grows vDOT’s value in DOT.</p>
      <p>{dotFunding ? "Both the initial vault loan and the loop loan owe DOT and pay the selected DOT borrow rate. There is no HOLLAR funding loan or interest discount in this scenario." : "Saved HOLLAR-funded scenario: reset to switch to the new direct-DOT funding model."} This models <strong>new funding</strong>; existing capital is not actively reallocated.</p>
      <p><strong>Contract compatibility:</strong> direct DOT funding needs a DOT debt ledger, DOT repayment/settlement and a vDOT strategy. The deployed Main ledger is fixed to HOLLAR, so this is an economics preview of a new design.</p>
    </div><div className="controls"><button onClick={() => onChange({ ...VDOT_DEFAULTS })}>reset vDOT assumptions</button><button onClick={exportResult}>export vDOT results</button></div></div>
    <div className="banner" role="status" data-testid="vdot-status">
      <strong>{r.capacityExceeded ? "Requested target fails market or capacity checks." : "Market checks pass at the pinned snapshot; execution still needs validation."}</strong>{" "}
      Mainnet block {Number(m.block).toLocaleString("en-US")}, {new Date(Number(m.timestamp) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC. This is an analytical candidate; no vDOT strategy contracts are deployed by this preview.
      {r.assetsUSD > 0 && r.debtUSD / r.assetsUSD > r.maxLtv && <p><strong>Borrow limit:</strong> the requested loop LTV is {fmtPct(r.debtUSD / r.assetsUSD)}, above the {fmtPct(r.maxLtv, 0)} limit. New borrowing requires HF ≥ {fmtX(r.minimumBorrowableHf, 4)}. Carry below describes the theoretical target.</p>}
      <p><strong>Pinned funding quote:</strong> {fmtNum(Number(seedQuote.amountIn))} {p.fundingAsset} → vDOT, approximately $75,000 of input at the snapshot, costs {fmtBps(seedQuote.costVsOracleBps)} versus the oracle. Carry excludes execution costs. This one-shot quote is not a full ramp.</p>
    </div>
    <div className="strategy-layout">
      <aside className="strategy-settings" aria-label="vDOT settings">
        {(["Funding", "Price shock", "Oracle stress", "Capacity assumptions"] as const).map((group) => <details key={group} open={group === "Funding" || group === "Price shock"}>
          <summary>{group}</summary>
          {group === "Funding" && <label className="strategy-field toggle"><span><input type="checkbox" aria-label="DOT eMode" checked={p.useEMode} onChange={(e) => onChange({ ...p, useEMode: e.target.checked })} /> DOT eMode</span><small>{p.useEMode ? "85% max LTV / 92% liquidation threshold" : "60% max LTV / 70% liquidation threshold"}. Minimum borrowable HF: {fmtX(r.minimumBorrowableHf, 4)}.</small></label>}
          {VDOT_FIELDS.filter((f) => f.group === group && (f.key !== "mainDiscount" || !dotFunding)).map((f) => <div key={f.key}>
            {f.key === "dotBorrowApr" && <label className="strategy-field toggle"><span><input type="checkbox" aria-label="Use DOT reserve curve" checked={p.dotBorrowApr === null} onChange={(e) => onChange({ ...p, dotBorrowApr: e.target.checked ? null : r.dotMarketBorrowRate })} /> Use DOT reserve curve</span><small>After funding: {fmtPct(r.dotMarketBorrowRate, 4)} APR. Uncheck to enter your own rate.</small></label>}
            <NumericField field={f} value={p[f.key] ?? r.dotMarketBorrowRate} disabled={f.key === "dotBorrowApr" && p.dotBorrowApr === null} onChange={(value) => onChange({ ...p, [f.key]: value })} />
          </div>)}
        </details>)}
      </aside>
      <div className="strategy-results">
        <h2>Carry at flat DOT / USD</h2>
        <div className="tiles" aria-label="vDOT carry results">
          <div className="tile"><div className="label">{r.capacityExceeded ? "Theoretical carry APR" : "Depositor carry APR"}</div><div className="value" data-testid="vdot-apr">{fmtPct(r.depositorApr)}</div><div className="sub">{fmtUsd(r.depositorUSD)} / year before execution costs</div></div>
          <div className="tile"><div className="label">Monthly compounded APY</div><div className="value">{fmtPct(r.depositorMonthlyApy)}</div><div className="sub">constant carry, no DOT price change</div></div>
          <div className="tile"><div className="label">Protocol income / TVL</div><div className="value">{fmtPct(r.protocolIncomePerTvl)}</div><div className="sub">{fmtUsd(r.protocolUSD)} / year; not an APY</div></div>
          <div className="tile"><div className="label">Loop leverage / DOT borrow APR</div><div className="value">{fmtX(r.leverage)} / {fmtPct(r.dotBorrowRate)}</div><div className="sub">{p.dotBorrowApr === null ? "reserve curve" : "manual rate"}; utilization after funding: {fmtPct(r.dotUtilization)}</div></div>
        </div>
        <div className="strategy-cards">
          <section className="card"><h2>Annual carry waterfall</h2><Waterfall steps={[
            { label: "vDOT income", value: (r.stakingIncomeUSD + r.supplyIncomeUSD) / p.tvl, kind: "start" },
            { label: "Loop DOT interest", value: -r.loopInterestUSD / p.tvl, kind: "sub" },
            { label: "Harvest fee", value: -r.feeUSD / p.tvl, kind: "sub" },
            { label: `Vault ${p.fundingAsset} interest`, value: -r.mainInterestUSD / p.tvl, kind: "sub" },
            { label: "Depositor", value: r.depositorApr, kind: "total" },
          ]} /><p className="small">vDOT supply interest adds {fmtUsd(r.supplyIncomeUSD)} / year. The harvest fee applies after loop interest; the initial vault loan’s interest is then paid from the remainder. DOT loans receive no interest discount. Swap fees and price impact are excluded.</p></section>
          <section className="card"><h2>Protocol income / year</h2><table className="grid"><tbody>
            <tr><td>Harvest fee</td><td className="num">{fmtUsd(r.feeUSD, false)}</td></tr>
            {!dotFunding && <tr><td>Paid Main HOLLAR interest</td><td className="num">{fmtUsd(r.mainProtocolIncomeUSD, false)}</td></tr>}
            <tr><td>DOT reserve-factor income ({dotFunding ? "both loans" : "loop loan"})</td><td className="num">{fmtUsd(r.dotReserveIncomeUSD, false)}</td></tr>
            <tr className="hi"><td>Total</td><td className="num">{fmtUsd(r.protocolUSD, false)}</td></tr>
          </tbody></table><p className="small">The remaining DOT interest goes to reserve suppliers. The swap route’s aDOT belongs to pool participants; this strategy does not earn that lending yield. Income changes on existing borrowers are excluded.</p></section>
        </div>
        <section className="card"><h2>Compare with PRIME / HOLLAR</h2><div className="strategy-table"><table className="grid"><thead><tr><th>Same new TVL and fee</th><th className="num">vDOT / DOT</th><th className="num">PRIME / HOLLAR</th></tr></thead><tbody>
          <tr><td>Depositor carry APR</td><td className="num">{fmtPct(r.depositorApr)}</td><td className="num">{fmtPct(r.legacy.depositorApr)}</td></tr>
          <tr><td>Annual protocol income / TVL</td><td className="num">{fmtPct(r.protocolIncomePerTvl)}</td><td className="num">{fmtPct(r.legacy.protocolIncomePerTvl)}</td></tr>
          <tr><td>Funding / loop debt currency</td><td className="num">{p.fundingAsset} / DOT</td><td className="num">HOLLAR / HOLLAR</td></tr>
          <tr><td>Total borrowing, USD at entry</td><td className="num">{fmtUsd(r.equityUSD + r.debtUSD)}</td><td className="num">{fmtUsd(r.legacy.hollarDebt)}</td></tr>
          <tr><td>Loop leverage</td><td className="num">{fmtX(r.leverage)}</td><td className="num">{fmtX(r.legacy.leverage)}</td></tr>
        </tbody></table></div><p className="small">Same snapshot, TVL, initial funding LTV and fee. PRIME benchmark keeps HOLLAR funding, {dotFunding ? "40%" : fmtPct(p.mainDiscount, 0)} Main discount, HF 1.05, 6.2% native growth and a 90% loop discount on up to $5m debt. vDOT uses {p.fundingAsset} funding and editable {fmtPct(p.stakingApr)} native growth. These targets omit execution costs and have different borrowing and liquidation risks.</p></section>
        <section className="card"><h2>Harvest-fee comparison</h2><div className="strategy-table"><table className="grid"><thead><tr><th>Fee</th><th className="num">Depositor carry APR</th><th className="num">Protocol income / TVL</th></tr></thead><tbody>
          {[0, 0.22, 0.4, 0.69].map((fee) => { const c = evaluateVdot({ ...p, fee }); return <tr key={fee} className={p.fee === fee ? "hi" : ""}><td><button aria-pressed={p.fee === fee} onClick={() => onChange({ ...p, fee })}>{fmtPct(fee, 0)} fee</button></td><td className="num">{fmtPct(c.depositorApr)}</td><td className="num">{fmtPct(c.protocolIncomePerTvl)}</td></tr>; })}
        </tbody></table></div><p className="small">Depositor break-even harvest fee before execution costs: {r.breakEvenFee === null ? "no positive carry" : r.breakEvenFee < 0 ? "negative even at 0% fee" : fmtPct(r.breakEvenFee)}. This compares economics; it does not change governance settings.</p></section>
        <section className="card vdot-risk"><h2>Two borrowing positions, two health factors</h2><p>The lending oracle prices vDOT as the Bifrost DOT-per-vDOT conversion rate × the same DOT/USD feed used for debt. Common DOT price changes and market trading discounts leave the loop’s oracle HF unchanged. Debt growth or a conversion-rate feed change can reduce loop HF; a market discount affects exit execution.</p><p>{dotFunding ? "Including the initial DOT funding loan, the strategy’s principal is matched in DOT. A common DOT price move creates no funding mismatch at an unchanged conversion rate. The original vault collateral is a separate position: a rising DOT debt price lowers its HF when that collateral’s USD value stays fixed." : `The source retains ${fmtNum(r.netDotExposure)} DOT of exposure against fixed HOLLAR funding.`}</p>
          <div className="controls">{[-0.5, -0.3, 0, 0.3, 0.5].map((dotMove) => <button key={dotMove} aria-pressed={p.dotMove === dotMove && p.vdotMove === 0} onClick={() => onChange({ ...p, dotMove, vdotMove: 0 })}>{dotMove >= 0 ? "+" : ""}{fmtPct(dotMove, 0)} DOT</button>)}</div>
          <div className="tiles" aria-label="vDOT price shock results">
            <div className="tile"><div className="label">Source surplus vs funding / TVL</div><div className="value" data-testid="vdot-shock-pnl">{fmtPct(r.pricePnlPerTvl)}</div><div className="sub">{fmtUsd(r.pricePnlUSD)}, before interest and fees</div></div>
            <div className="tile"><div className="label">Loop HF after shock</div><div className="value" data-testid="vdot-shock-hf">{r.stressedHf === null ? "no debt" : fmtX(r.stressedHf, 3)}</div><div className="sub">{r.liquidatable ? "below 1: liquidatable; recovery not modeled" : "instant oracle move, no keeper response"}</div></div>
            <div className="tile"><div className="label">Vault HF after shock</div><div className="value" data-testid="vdot-main-hf">{r.stressedMainHf === null ? "no debt" : fmtX(r.stressedMainHf, 3)}</div><div className="sub">{r.mainLiquidatable ? "below 1: vault liquidatable before rebalancing" : `vault borrowing LTV: ${fmtPct(r.stressedMainLtv)}`}</div></div>
            <div className="tile"><div className="label">Source funding coverage</div><div className="value">{r.stressedSourceCoverage === null ? "no funding" : fmtPct(r.stressedSourceCoverage)}</div><div className="sub">{fmtUsd(r.sourceShortfallUSD)} shortfall vs {p.fundingAsset} funding at its shocked price</div></div>
          </div>
          <p className="small">DOT move {fmtPct(p.dotMove)}; oracle conversion-rate change {fmtPct(p.vdotMove)}. Oracle stress changes the feed itself, not the market trading price. Original vault collateral is held fixed. These are instant oracle marks before interest, liquidation, exits or harvesting; they are not added to annual carry APR.</p>
        </section>
        <div className="strategy-cards">
          <section className="card"><h2>Full-ramp position and reserve</h2><table className="grid"><tbody>
            <tr><td>Initial vault {p.fundingAsset} loan</td><td className="num">{dotFunding && `${fmtNum(r.mainDebtDOT)} DOT / `}{fmtUsd(r.equityUSD)}</td></tr>
            <tr><td>vDOT collateral</td><td className="num">{fmtNum(r.assetsVdot)} / {fmtUsd(r.assetsUSD)}</td></tr>
            <tr><td>DOT loop debt</td><td className="num">{fmtNum(r.debtDOT)} / {fmtUsd(r.debtUSD)}</td></tr>
            <tr><td>Total new DOT debt</td><td className="num">{fmtNum(r.totalDebtDOT)} DOT</td></tr>
            <tr><td>DOT re-supplied by swaps</td><td className="num">{fmtNum(r.dotResupply)}</td></tr>
            <tr><td>DOT reserve cash remaining</td><td className="num">{fmtNum(r.dotCash)}</td></tr>
            <tr><td>Total DOT reserve debt</td><td className="num">{fmtNum(r.dotDebt)}</td></tr>
            <tr><td>Total vDOT supplied to Aave</td><td className="num">{fmtNum(r.vdotSupply)}</td></tr>
          </tbody></table><p className="small">The pinned swap route is DOT → aDOT → vDOT through Aave and pool 690. The re-supply assumption affects reserve cash and utilization; it is not an extra collateral position. Routing and pool balances can change during a real ramp.</p></section>
          <section className="card"><h2>Market and capacity checks</h2><ul className="strategy-checks">{r.checks.map((c) => <li key={c.label}><span className={c.ok ? "pass" : "fail"}>{c.ok ? "Pass at snapshot" : "Failed"}</span>{c.label}</li>)}</ul><p className="small">Vault reference: GIGAETH standard mode, 80% max borrowing LTV and editable {fmtPct(p.mainLt, 0)} liquidation threshold. The separate vDOT loop uses its own mode. Candidate caps are assumptions; checks do not establish safe pacing or contract readiness. Requested targets are not clipped.</p></section>
        </div>
        <section className="card"><h2>Pinned router quotes</h2><p>Pool 690 holds {fmtNum(r.poolVdot)} vDOT; the requested target needs {fmtNum(r.assetsVdot)}. These independent quotes use sdk-next {quotes.sdkVersion} at block {quotes.block}. They do not update when you change the scenario.</p>
          <div className="strategy-table"><table className="grid"><thead><tr><th>Input</th><th className="num">Output</th><th className="num">Cost vs oracle</th><th className="num">Route fee</th><th>Route</th></tr></thead><tbody>{quotes.quotes.map((q, i) => <tr key={i}>
            <td>{fmtNum(Number(q.amountIn))} {token(q.assetIn)}</td><td className="num">{fmtNum(Number(q.quote.amountOut))} {token(q.assetOut)}</td><td className="num">{fmtBps(q.costVsOracleBps)}</td><td className="num">{fmtPct(q.quote.tradeFeePct / 100)}</td><td>{q.quote.swaps.map((s) => `${token(s.assetIn)} → ${token(s.assetOut)} (${s.pool})`).join("; ")}</td>
          </tr>)}</tbody></table></div>
          <p className="small">{dotFunding ? "Entry quotes show approximately 81,677 DOT of initial funding and 834,918 DOT of loop borrowing for the $100k / 75% LTV / HF 1.01 reference." : "The HOLLAR and large DOT quotes use the earlier $100k / HF 1.15 reference."} Fees are included in output. Cost vs oracle also includes basis and impact. Each quote sees the original pool state; they cannot be summed into a full-ramp cost. Large orders need sequential-tranche simulation.</p>
        </section>
        <details className="card"><summary>Sources and assumptions</summary>
          <p>Oracle adapter and shared DOT/USD source verified on two RPCs at blocks {oracle.pinned.block} and {oracle.current.block}; the conversion-rate product matches the lending price with zero residual. The adapter uses Bifrost’s ten-minute conversion-rate feed, not pool 690’s trading price.</p>
          <p>vDOT native growth: {fmtPct(m.vdotGrowth.simpleAnnualizedApr, 4)} simple annualized APR from {m.vdotGrowth.elapsedSeconds / 86400} days, block {m.vdotGrowth.pastBlock} to {m.block}. DOT per vDOT increased from {Number(m.vdotGrowth.pastRate) / 1e8} to {Number(m.vdotGrowth.latestRate) / 1e8}. This is backward-looking, net exchange-rate growth; staking fees are not subtracted again.</p>
          <p>DOT rate curve: 0% base, 2.75% at 85% utilization, 49.5% at full utilization. DOT reserve factor 10%. vDOT lending interest responds to its additional supply. No incentive APR is included.</p>
          <pre className="eq">{`funding = new TVL × vault borrowing LTV\nleverage = loop HF / (loop HF − loop liquidation threshold)\nvDOT assets = funding × leverage; loop debt = assets − funding\ncarry = assets × (vDOT growth + supply rate) − loop interest\ndepositor = carry − max(0, carry) × fee − vault funding interest\nsource surplus = shocked assets − shocked loop debt − shocked funding debt\nvault HF = original collateral × vault LT / shocked funding debt`}</pre>
          <p>{VDOT_SCOPE}</p>
          <p>The snapshot’s reserve supplies and debts agree across two RPCs with zero residuals. The vDOT rate feed was {m.vdotGrowth.feedAgeSeconds} seconds old and the DOT/USD feed {m.reserves.DOT.round.ageSeconds} seconds old at that block. Source hash: <code className="strategy-hash">{m.hash}</code>.</p>
          <p><a href="https://docs.bifrost.io/faq/what-is-loopstake">Bifrost leveraged-staking mechanics</a> · <a href="https://docs.bifrost.io/faq/what-are-vtokens/vdot">vDOT exchange-rate mechanics</a> · <a href="https://github.com/galacticcouncil/sdk">Hydration routing SDK</a>. Quotes and raw market evidence are included in the export.</p>
        </details>
      </div>
    </div>
  </div>;
}
