import { useState } from "react";
import { DEPLOYMENTS, loadLive } from "../engine/live/live";
import type { Params } from "../engine/params/types";

export function LiveLoader({ p, onApply, onLoaded }: { p: Params; onApply: (p: Params) => void; onLoaded: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [dep, setDep] = useState(DEPLOYMENTS[0].key);
  const [url, setUrl] = useState(DEPLOYMENTS[0].rpc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = DEPLOYMENTS.find((x) => x.key === dep)!;
      const s = await loadLive(d, url);
      const next = s.apply(p);
      onApply(next);
      const age = Math.max(0, Math.round(Date.now() / 1000 - s.timestamp));
      onLoaded(`live state from ${d.label} at block ${s.block.toLocaleString("en-US")} (${age < 120 ? `${age} s` : `${Math.round(age / 60)} min`} old): ${s.changes.length ? `updated ${s.changes.join(", ")}` : "nothing changed"}${s.notes.length ? ` · ${s.notes.join(" · ")}` : ""}`);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} title="read the running chain and project from its current state">load live state ▾</button>
      {open && (
        <div className="popover">
          <label>deployment <select value={dep} onChange={(e) => { setDep(e.target.value); setUrl(DEPLOYMENTS.find((x) => x.key === e.target.value)!.rpc); }}>
            {DEPLOYMENTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select></label>
          <label>rpc <input className="search" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <p className="small muted">
            Reads the loop, both vaults, pool 143, prices, rates, contract settings and PRIME's 7-day yield at the chain head, into the scenario you're editing. Your other settings stay. The share link then carries this state.
          </p>
          <button className="primary" disabled={busy} onClick={run}>{busy ? "reading…" : "load"}</button>
          {error && <p className="small" style={{ color: "var(--critical)" }}>{error}</p>}
        </div>
      )}
    </span>
  );
}
