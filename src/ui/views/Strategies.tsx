import { useMemo, useState } from "react";
import { evaluateStrategies, STRATEGY_DEFAULTS, STRATEGY_FIELDS, STRATEGY_MARKET, STRATEGY_SCOPE, type StrategyField, type StrategyParams } from "../../engine/model/twoStrategy";
import { StackBar, Waterfall } from "../charts/Svg";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "../fmt";

function Field({ field, value, onChange }: { field: StrategyField; value: number; onChange: (value: number) => void }) {
  const scale = field.unit === "%" ? 100 : 1;
  const display = Number((value * scale).toPrecision(12));
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return <label className="strategy-field">
    <span>{field.label} <span className="muted">{field.unit}</span></span>
    <input aria-label={field.label} type="number" value={editing ? text : String(display)} min={field.min * scale} max={field.max * scale} step={field.step * scale}
      onFocus={() => { setText(String(display)); setEditing(true); }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value) / scale;
        if (e.target.value !== "" && Number.isFinite(v) && v >= field.min && v <= field.max) onChange(v);
      }} onBlur={() => setEditing(false)} />
    <small>{field.help}</small>
  </label>;
}

export function Strategies({ p, onChange }: { p: StrategyParams; onChange: (p: StrategyParams) => void }) {
  const r = useMemo(() => evaluateStrategies(p), [p]);
  const comparisons = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((weight) => ({ weight, r: evaluateStrategies({ ...p, weight }) })), [p]);
  const m = STRATEGY_MARKET;
  const apy = m.reserves.apyUSD;
  const rows = [
    { label: "Net HOLLAR funding", value: r.equity, format: fmtUsd },
    { label: "Gross assets (USD)", value: r.grossAssetsUSD, format: fmtUsd },
    { label: "Loop debt (USD)", value: r.debtUSD, format: fmtUsd },
    { label: "Leverage", value: r.leverage, format: fmtX },
    { label: "Relative price drop to HF 1", value: r.liquidationDrop, format: fmtPct },
    { label: "Asset income / year", value: r.grossIncomeUSD, format: fmtUsd },
    { label: "Debt cost / year", value: r.debtCostUSD, format: fmtUsd },
    { label: "Carry before blended fee / year", value: r.carryUSD, format: fmtUsd },
  ];
  const exportResult = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot: m, params: p, result: r, scope: STRATEGY_SCOPE }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "juicenomics-two-strategy.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="strategies">
    <div className="strategy-intro">
      <div><h1>Two strategies, one harvest fee</h1>
        <p>Main borrows HOLLAR. New funding splits between PRIME / HOLLAR and apyUSD / PRIME, held in separate strategy accounts. Both harvest assets convert into vault collateral.</p>
        <p>Launch starts at <strong>100% PRIME / 0% apyUSD</strong>. Weights guide future funding and ordinary exits; existing capital is not actively reallocated. This view compares the fully funded targets.</p></div>
      <div className="controls"><button onClick={() => onChange({ ...STRATEGY_DEFAULTS })}>reset strategy assumptions</button><button onClick={exportResult}>export results</button></div>
    </div>
    <div className="banner" role="status">
      <strong>{r.apyBlocked ? "Hypothetical allocation — apyUSD activation blocked." : "Legacy-only target — apyUSD starts disabled."}</strong>{" "}
      Pinned mainnet snapshot: {new Date(Number(m.timestamp)).toISOString().slice(0, 16).replace("T", " ")} UTC, block {Number(m.block).toLocaleString("en-US")}.
      {" "}The apyUSD oracle is stale, PRIME cannot be borrowed in isolation, and apyUSD has no isolation headroom. This is a carry estimate, not a live executable quote.
      {r.capacityExceeded && <p><strong>The requested target also exceeds capacity limits.</strong> Estimates below keep the requested allocation; they do not simulate partial funding.</p>}
    </div>
    <div className="strategy-layout">
      <aside className="strategy-settings" aria-label="two-strategy settings">
        {(["Funding", "Carry assumptions", "Capacity limits"] as const).map((group) => <details key={group} open={group === "Funding"}>
          <summary>{group}</summary>
          {STRATEGY_FIELDS.filter((d) => d.group === group).map((d) => <Field key={d.key} field={d} value={p[d.key]} onChange={(v) => onChange({ ...p, [d.key]: v })} />)}
        </details>)}
      </aside>
      <div className="strategy-results">
        <div className="tiles" aria-label="two-strategy results">
          <div className="tile"><div className="label">Depositor carry APR</div><div className="value" data-testid="strategy-apr">{fmtPct(r.depositorApr)}</div><div className="sub">{fmtUsd(r.depositorUSD)} / year, before execution costs</div></div>
          <div className="tile"><div className="label">Monthly compounded APY</div><div className="value">{fmtPct(r.depositorMonthlyApy)}</div><div className="sub">constant net carry, monthly reinvestment</div></div>
          <div className="tile"><div className="label">Protocol income / TVL</div><div className="value">{fmtPct(r.protocolRevenuePerTvl)}</div><div className="sub">{fmtUsd(r.protocolUSD)} / year; not compounded APY</div></div>
          <div className="tile"><div className="label">HOLLAR debt added</div><div className="value">{fmtUsd(r.hollarDebtUSD)}</div><div className="sub">Main {fmtUsd(r.mainDebtHollar)} + legacy loop</div></div>
        </div>
        <div className="card">
          <h2>New HOLLAR funding</h2>
          <StackBar segments={[
            { label: "PRIME / HOLLAR", value: r.equity[0], color: "var(--series-1)" },
            { label: "apyUSD / PRIME", value: r.equity[1], color: "var(--series-3)" },
          ]} fmt={fmtUsd} />
          <label className="strategy-slider">apyUSD {fmtPct(p.weight, 0)} · PRIME {fmtPct(1 - p.weight, 0)}
            <input aria-label="apyUSD weight slider" type="range" min="0" max="100" step="1" value={p.weight * 100} onChange={(e) => onChange({ ...p, weight: Number(e.target.value) / 100 })} />
          </label>
        </div>
        <div className="strategy-cards">
          <section className="card"><h2>Annual depositor waterfall</h2>
            <Waterfall steps={[
              { label: "Asset income", value: (r.grossIncomeUSD[0] + r.grossIncomeUSD[1]) / p.tvl, kind: "start" },
              { label: "Loop debt", value: -(r.debtCostUSD[0] + r.debtCostUSD[1]) / p.tvl, kind: "sub" },
              { label: "Blended fee", value: -r.protocolFeeUSD / p.tvl, kind: "sub" },
              { label: "Main interest", value: -r.mainCostUSD / p.tvl, kind: "sub" },
              { label: "Depositor", value: r.depositorApr, kind: "total" },
            ]} />
            <p className="small">The {fmtPct(p.fee, 0)} fee applies once to positive aggregate carry. A loss in either strategy reduces that fee base. Main interest is serviced after the fee.</p>
          </section>
          <section className="card"><h2>Protocol income / year</h2>
            <table className="grid"><tbody>
              <tr><td>Blended harvest fee</td><td className="num">{fmtUsd(r.protocolFeeUSD, false)}</td></tr>
              <tr><td>Paid Main HOLLAR interest</td><td className="num">{fmtUsd(r.mainCostUSD, false)}</td></tr>
              <tr><td>Paid legacy HOLLAR interest</td><td className="num">{fmtUsd(r.debtCostUSD[0], false)}</td></tr>
              <tr><td>New PRIME reserve-factor income</td><td className="num">{fmtUsd(r.primeReserveIncomeUSD, false)}</td></tr>
              <tr className="hi"><td>Total</td><td className="num">{fmtUsd(r.protocolUSD, false)}</td></tr>
            </tbody></table>
            <p className="small">PRIME debt costs {fmtUsd(r.primeDebtDriftUSD)} in price appreciation plus {fmtUsd(r.primeDebtInterestUSD)} in interest per year. Appreciation is a depositor cost; it is not protocol income. Revenue here excludes repricing existing borrowers.</p>
          </section>
        </div>
        <section className="card"><h2>Strategy positions at full ramp</h2>
          <div className="strategy-table"><table className="grid"><thead><tr><th>Position</th><th className="num">PRIME / HOLLAR</th><th className="num">apyUSD / PRIME</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td className="num">{row.format(row.value[0])}</td><td className="num">{row.format(row.value[1])}</td></tr>)}</tbody>
          </table></div>
          <p className="small">The HF distance assumes an instantaneous collateral/debt relative price move, before interest or keeper response. Main collateral risk is outside this comparison.</p>
        </section>
        <section className="card"><h2>Compare allocations</h2><p className="small">Same new TVL and fee in every row. Select a weight to inspect it. Positive apyUSD rows remain hypothetical.</p>
          <div className="strategy-table"><table className="grid"><thead><tr><th>apyUSD weight</th><th className="num">Depositor APR</th><th className="num">Protocol income / TVL</th><th className="num">PRIME borrow APR</th><th>Target status</th></tr></thead>
            <tbody>{comparisons.map(({ weight, r: c }) => <tr key={weight} className={weight === p.weight ? "hi" : ""}>
              <td><button aria-pressed={weight === p.weight} onClick={() => onChange({ ...p, weight })}>{fmtPct(weight, 0)} apyUSD</button></td>
              <td className="num">{fmtPct(c.depositorApr)}</td><td className="num">{fmtPct(c.protocolRevenuePerTvl)}</td><td className="num">{fmtPct(c.primeBorrowRate)}</td>
              <td>{c.apyBlocked ? "apyUSD blocked" : "Legacy only"}{c.capacityExceeded ? " · over capacity" : ""}</td>
            </tr>)}</tbody></table></div>
        </section>
        <div className="strategy-cards">
          <section className="card"><h2>PRIME reserve after new funding</h2>
            <table className="grid"><tbody>
              <tr><td>PRIME supplied by this position</td><td className="num">{fmtNum(r.extraPrimeSupply, 0)}</td></tr>
              <tr><td>PRIME borrowed by this position</td><td className="num">{fmtNum(r.extraPrimeDebt, 0)}</td></tr>
              <tr><td>Total reserve debt / borrow cap</td><td className="num">{fmtNum(r.primeDebt, 0)} / {fmtNum(Number(m.reserves.PRIME.borrowCap), 0)}</td></tr>
              <tr><td>Remaining cash (PRIME)</td><td className="num">{fmtNum(r.primeCash, 0)}</td></tr>
              <tr><td>Utilization</td><td className="num">{fmtPct(r.utilization)}</td></tr>
              <tr><td>Borrow / supply APR</td><td className="num">{fmtPct(r.primeBorrowRate)} / {fmtPct(r.primeSupplyRate)}</td></tr>
            </tbody></table>
            <p className="small">Legacy PRIME supply lowers utilization; apyUSD-loop borrowing raises it. Rate curve: 0% base, 2% at 75% utilization, 22% at full utilization. Above full utilization, the theoretical rate is capped at 22% and the target cannot be funded.</p>
          </section>
          <section className="card"><h2>Capacity checks</h2>
            <ul className="strategy-checks">{r.capacity.map((x) => <li key={x.label}><span className={x.ok ? "pass" : "fail"}>{x.ok ? "Within limit / unused" : "Exceeded"}</span>{x.label}</li>)}</ul>
            <p className="small">These checks cover the requested marginal position, not total deployed source exposure. HOLLAR mint headroom and actual swap execution are not evaluated. Passing is not an activation approval.</p>
          </section>
        </div>
        <section className="card"><h2>apyUSD prerequisites at the pinned block</h2>
          <ul className="strategy-checks">{r.prerequisites.map((x) => <li key={x.label}><span className={x.ok ? "pass" : "fail"}>{x.ok ? "Passed" : "Blocked"}</span>{x.label}</li>)}</ul>
          <p>Oracle: ${Number(apy.priceUSD8) / 1e8}, last updated {new Date(Number(apy.round.updatedAt) * 1000).toISOString().slice(0, 10)} ({Math.floor(Number(apy.round.ageSeconds) / 86400)} days old at the snapshot). Isolation debt: {fmtUsd(Number(apy.isolationDebtUSD2) / 100)} against a {fmtUsd(Number(apy.isolationCeilingUSD2) / 100)} ceiling.</p>
          <p>Full-ramp demand: {fmtNum(r.apyTokensAtCurrentOracle)} apyUSD at the pinned oracle, versus {fmtNum(r.pool146Apy)} apyUSD held by pool 146. {r.apyTokensAtCurrentOracle > r.pool146Apy && <strong>Demand exceeds the pool’s entire apyUSD balance. </strong>}Balances are not swap quotes: price impact, refill and oracle corrections still need evaluation.</p>
        </section>
        <details className="card"><summary>Equations, sources and scope</summary>
          <pre className="eq">{`Main HOLLAR = new TVL × Main LTV\nstrategy equity = Main HOLLAR × target weight\nleverage = HF / (HF − liquidation threshold)\nassets = equity × leverage; debt = assets − equity\ncarry = asset income − HOLLAR interest − PRIME interest − PRIME debt appreciation\nfee = max(0, combined carry) × blended fee\ndepositor = combined carry − fee − Main HOLLAR interest`}</pre>
          <p>{STRATEGY_SCOPE}</p>
          <p>Yield assumptions start at PRIME 6.2% and apyUSD 12.97% APR from the earlier carry study; they are editable historical assumptions, not refreshed fair-value yields. The snapshot was cross-checked against two independent RPCs with zero supply/debt residuals. Positive apyUSD scenarios assume prerequisites are resolved while keeping these pinned prices and rates.</p>
          <p>PRIME units are priced at ${Number(m.reserves.PRIME.priceUSD8) / 1e8}, not $1. The legacy discount applies only up to its debt cap. Monthly APY assumes constant net carry and monthly reinvestment. The legacy Overview and Simulation tabs use their own Lark settings; strategy controls do not change them.</p>
          <p>Source: <a href={m.rpc}>Hydration archive RPC</a>, chain {m.chainId}, block {m.block}. Hash <code className="strategy-hash">{m.hash}</code>. The export includes the complete snapshot and assumptions.</p>
        </details>
      </div>
    </div>
  </div>;
}
