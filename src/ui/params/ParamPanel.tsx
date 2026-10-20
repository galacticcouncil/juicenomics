import { useMemo, useState } from "react";
import { LARK4 } from "../../engine/params/defaults";
import { GROUPS, PARAMS, getPath, type ParamDef } from "../../engine/params/schema";
import type { Params } from "../../engine/params/types";
import { fmtNum, fromDisplay, toDisplay, unitLabel } from "../fmt";

// fields that only matter in some modes
const VISIBLE: Record<string, (p: Params) => boolean> = {
  "loop.targetHf": (p) => p.loop.mode === "hf",
  "market.stressDay": (p) => ["v20", "crash30", "oracleStep"].includes(p.market.stress),
  "loop.hfLag": (p) => p.loop.mode === "hf",
  "loop.leverage": (p) => p.loop.mode === "lev",
  "arb.sellBps": (p) => p.arb.mode === "fixed",
  "arb.exit10kBps": (p) => p.arb.mode === "realistic",
  "arb.exit100kBps": (p) => p.arb.mode === "realistic",
  "arb.fixedUsd": (p) => p.arb.mode === "realistic",
  "arb.tradeUsd": (p) => p.arb.mode === "realistic",
  "arb.marginBps": (p) => p.arb.mode === "realistic",
  "costs.entryBps": (p) => p.costs.mode === "manual",
  "costs.unwindBps": (p) => p.costs.mode === "manual",
  "depositFee.auto": (p) => p.depositFee.on,
  "depositFee.bps": (p) => p.depositFee.on && !p.depositFee.auto,
  "depositFee.dest": (p) => p.depositFee.on,
  "improvements.deskMode": (p) => p.improvements.desk,
  "improvements.deskPrime": (p) => p.improvements.desk,
  "improvements.deskSpreadBps": (p) => p.improvements.desk,
  "improvements.deskBid": (p) => p.improvements.desk,
  "improvements.incentiveScope": (p) => p.improvements.incentiveBps > 0,
  "flows.growthFactor": (p) => p.flows.growth !== "none",
  "vaults.eth.tvlCap": (p) => p.vaults.eth.capOn,
  "vaults.btc.tvlCap": (p) => p.vaults.btc.capOn,
};

const LEVER: Record<string, { label: string; title: string }> = {
  admin: { label: "admin", title: "settable today by governance or the committee" },
  ops: { label: "ops", title: "keeper, desk or arb operations" },
  contract: { label: "contract", title: "needs a contract change" },
  market: { label: "market", title: "market condition" },
  model: { label: "model", title: "modelling assumption" },
  state: { label: "state", title: "chain state the projection starts from" },
};

function changed(p: Params, d: ParamDef): boolean {
  const a = getPath(p, d.path);
  const b = getPath(LARK4, d.path);
  return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b)) : a !== b;
}

function NumberField({ d, value, onChange }: { d: ParamDef; value: number; onChange: (v: number) => void }) {
  const shown = toDisplay(d.unit, value);
  const lo = toDisplay(d.unit, d.min ?? 0);
  const hi = toDisplay(d.unit, d.max ?? 100);
  const step = toDisplay(d.unit, d.step ?? 1);
  // log sliders map position 0..1000 onto the range
  const pos = d.log && lo >= 0 ? Math.round((1000 * Math.log1p(shown - lo)) / Math.log1p(hi - lo)) : shown;
  const fromPos = (x: number) => (d.log && lo >= 0 ? lo + Math.expm1((x / 1000) * Math.log1p(hi - lo)) : x);
  const snap = (x: number) => Math.round(x / step) * step;
  return (
    <div className="field">
      <input
        type="range"
        min={d.log && lo >= 0 ? 0 : lo}
        max={d.log && lo >= 0 ? 1000 : hi}
        step={d.log && lo >= 0 ? 1 : step}
        value={pos}
        onChange={(e) => onChange(fromDisplay(d.unit, snap(fromPos(Number(e.target.value)))))}
      />
      <input
        className="numin"
        type="number"
        step={step}
        value={Number(shown.toFixed(Math.min(8, Math.max(0, Math.ceil(-Math.log10(step)) + (d.log ? 1 : 0)))))}
        onChange={(e) => {
          const x = Number(e.target.value);
          if (Number.isFinite(x)) onChange(fromDisplay(d.unit, x));
        }}
      />
      <span className="unit">{unitLabel(d.unit)}</span>
    </div>
  );
}

function Row({ d, p, set }: { d: ParamDef; p: Params; set: (path: string, v: unknown) => void }) {
  const value = getPath(p, d.path);
  const isChanged = changed(p, d);
  const def = getPath(LARK4, d.path);
  const defText = typeof def === "number" ? `${fmtNum(toDisplay(d.unit, def), 6)}${unitLabel(d.unit)}` : String(def);
  return (
    <div className={`row ${isChanged ? "changed" : ""}`}>
      <div className="rowhead">
        <button className="dot" title={isChanged ? `reset to Lark 4 (${defText})` : "Lark 4 value"} disabled={!isChanged} onClick={() => set(d.path, def)}>
          {isChanged ? "●" : "○"}
        </button>
        <span className="plabel" title={`${d.help}${d.source ? `\nsource: ${d.source}` : ""}\nLark 4: ${defText}`}>
          {d.label}
        </span>
        <span className={`lever ${d.lever}`} title={LEVER[d.lever].title}>{LEVER[d.lever].label}</span>
        {d.scope === "mc" && <span className="lever mc" title="only used by the Monte Carlo simulation">sim</span>}
      </div>
      {d.kind === "number" && <NumberField d={d} value={value as number} onChange={(v) => set(d.path, v)} />}
      {d.kind === "bool" && (
        <label className="toggle">
          <input type="checkbox" checked={value as boolean} onChange={(e) => set(d.path, e.target.checked)} />
          <span>{(value as boolean) ? "on" : "off"}</span>
        </label>
      )}
      {d.kind === "enum" && (
        <select value={value as string} onChange={(e) => set(d.path, e.target.value)}>
          {d.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}

export function ParamPanel({ p, set }: { p: Params; set: (path: string, v: unknown) => void }) {
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ market: true, loop: true, improvements: true, fees: true });
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PARAMS.filter((d) => (VISIBLE[d.path]?.(p) ?? true) && (!onlyChanged || changed(p, d)) && (!q || `${d.label} ${d.help} ${d.path}`.toLowerCase().includes(q)));
  }, [p, query, onlyChanged]);
  const count = PARAMS.filter((d) => changed(p, d)).length;
  return (
    <aside className="panel">
      <div className="panelbar">
        <input className="search" placeholder="search parameters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="small"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> changed ({count})</label>
      </div>
      {GROUPS.map((g) => {
        const rows = visible.filter((d) => d.group === g.key);
        if (!rows.length) return null;
        const isOpen = open[g.key] || !!query || onlyChanged;
        return (
          <section key={g.key} className={`group ${g.key === "improvements" ? "improve" : ""}`}>
            <button className="grouphead" onClick={() => setOpen({ ...open, [g.key]: !open[g.key] })}>
              {isOpen ? "▾" : "▸"} {g.label} <span className="muted small">{rows.length}</span>
            </button>
            {isOpen && rows.map((d) => <Row key={d.path} d={d} p={p} set={set} />)}
          </section>
        );
      })}
    </aside>
  );
}
