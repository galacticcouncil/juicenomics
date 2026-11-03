import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { evaluate } from "./engine/model/closedForm";
import { DEPLOYMENT, DEPLOYMENT_KEYS, LARK4, SNAPSHOTS, baseline, clone } from "./engine/params/defaults";
import { preset, presetsFor } from "./engine/params/presets";
import { setPath } from "./engine/params/schema";
import type { Params } from "./engine/params/types";
import { validate } from "./engine/params/validate";
import { VERSION, decode, encode, eraDefaults } from "./engine/share/codec";
import { ParamPanel } from "./ui/params/ParamPanel";
import { Overview } from "./ui/views/Overview";
import { Compare } from "./ui/views/Compare";
import { Explore } from "./ui/views/Explore";
import { Model } from "./ui/views/Model";
import { Simulation } from "./ui/views/Simulation";
import { useMonteCarlo } from "./ui/useMonteCarlo";
import { LiveLoader } from "./ui/LiveLoader";

type Tab = "overview" | "simulation" | "explore" | "compare" | "model";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "simulation", label: "Simulation" },
  { key: "explore", label: "Explore & optimize" },
  { key: "compare", label: "Compare A / B" },
  { key: "model", label: "Model & assumptions" },
];

function readHash(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}

export default function App() {
  const [A, setA] = useState<Params>(() => clone(LARK4));
  const [B, setB] = useState<Params | null>(null);
  const [side, setSide] = useState<"A" | "B">("A");
  const [tab, setTab] = useState<Tab>(() => (readHash().t as Tab) || "overview");
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => (localStorage.getItem("js:theme") as "light" | "dark") || "auto");
  const loaded = useRef(false);
  const mc = useMonteCarlo();

  // restore from the link, else from the last session
  useEffect(() => {
    (async () => {
      const h = readHash();
      // an omitted A means the defaults of its link's era, which an older B gives away
      const eraB = Number.parseInt(h.b ?? "", 10);
      const legacyA = !h.s && eraB < VERSION;
      const token = h.s ?? (location.hash ? (legacyA ? eraDefaults(eraB) : "") : localStorage.getItem("js:last") ?? "");
      const a = await decode(token);
      const notes: string[] = [];
      if (a.error) notes.push(`could not read the shared config (${a.error}); showing Lark 4 defaults`);
      if (a.era) notes.push(`this ${location.hash ? "link" : "saved session"} predates the 30 Oct Lark 4 refork (jBTC alone, headroom exits): it opens with the settings it was made with, jETH included; reset to Lark 4 for today's`);
      if (a.ignored.length) notes.push(`ignored unknown settings: ${a.ignored.join(", ")}`);
      if (a.clamped.length) notes.push(`clamped into range: ${a.clamped.join(", ")}`);
      setA(a.params);
      if (h.b) {
        // "0" was the unversioned default-B marker: it means the defaults of the era its link came from
        const era = Number.parseInt(h.s ?? "", 10);
        const b = await decode(h.b === "0" ? (era < VERSION ? eraDefaults(era) : "") : h.b);
        if (b.error) notes.push(`could not read scenario B (${b.error}); showing Lark 4 defaults there`);
        setB(b.params);
      }
      if (notes.length) setBanner(notes.join(" · "));
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "auto" ? "" : theme;
    if (theme === "auto") delete document.documentElement.dataset.theme;
    localStorage.setItem("js:theme", theme === "auto" ? "" : theme);
  }, [theme]);

  // keep the url in sync, debounced
  useEffect(() => {
    if (!loaded.current) return;
    const id = setTimeout(async () => {
      // in a comparison both sides carry their version, so neither can be read in the wrong era
      const s = await encode(A, !!B);
      const b = B ? await encode(B, true) : null;
      const q = new URLSearchParams();
      if (s) q.set("s", s);
      if (B && b) q.set("b", b);
      if (tab !== "overview") q.set("t", tab);
      const hash = q.toString();
      history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
      localStorage.setItem("js:last", s);
    }, 300);
    return () => clearTimeout(id);
  }, [A, B, tab]);

  const cur = side === "B" && B ? B : A;
  const setCur = side === "B" && B ? setB as (p: Params) => void : setA;
  const set = useCallback((path: string, v: unknown) => setCur(validate(setPath(cur, path, v)).params), [cur, setCur]);
  const deferred = useDeferredValue(cur);
  const result = useMemo(() => evaluate(deferred), [deferred]);
  const deferredA = useDeferredValue(A);
  const deferredB = useDeferredValue(B);
  const resA = useMemo(() => evaluate(deferredA), [deferredA]);
  const resB = useMemo(() => (deferredB ? evaluate(deferredB) : null), [deferredB]);
  const issues = validate(cur).issues.concat(result.issues);
  const chain = DEPLOYMENT[cur.deployment].name;
  const snapshot = SNAPSHOTS[cur.deployment];

  const share = async () => {
    await new Promise((r) => setTimeout(r, 350));
    try {
      await navigator.clipboard.writeText(location.href);
      setToast("link copied: it restores every setting");
    } catch {
      setToast(location.href);
    }
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="app">
      <header className="top">
        <span className="brand">Juicenomics<small>Juicer economics · model estimates, not a promise</small></span>
        <select aria-label="deployment" value={cur.deployment} onChange={(e) => setCur(clone(baseline(e.target.value)))} title="the chain the scenario models, and the vault it runs; switching loads that chain's settings and state">
          {DEPLOYMENT_KEYS.map((k) => <option key={k} value={k}>{DEPLOYMENT[k].label}</option>)}
        </select>
        <select aria-label="presets" className="presets" value="" onChange={(e) => { if (e.target.value) setCur(preset(e.target.value, cur.deployment)); }} title="load a preset into the scenario being edited">
          <option value="">presets…</option>
          {presetsFor(cur.deployment).map((p) => <option key={p.key} value={p.key} title={p.note}>{p.label}</option>)}
        </select>
        <span className="seg" title="edit scenario A or B; Compare shows both">
          <button className={side === "A" ? "on" : ""} onClick={() => setSide("A")}>A</button>
          <button className={side === "B" ? "on" : ""} onClick={() => { if (!B) setB(clone(A)); setSide("B"); }}>B</button>
        </span>
        {B && <button onClick={() => { setB(null); setSide("A"); }} title="drop scenario B">✕ B</button>}
        <button onClick={() => setCur(clone(baseline(cur.deployment)))} title={`${chain}'s settings at block ${snapshot.evmBlock}, fresh start`}>reset to {chain}</button>
        <LiveLoader p={cur} onApply={setCur} onLoaded={setBanner} />
        <span className="muted small" title="where the simulation starts: a fresh ramp, or the chain's loop and vault positions at a block">{cur.sim.initial === "fresh" ? "fresh start" : `state @ ${cur.sim.stateBlock.toLocaleString("en-US")} ${cur.sim.stateBlock === snapshot.evmBlock ? "(snapshot)" : "(live)"}`}</span>
        <span className="spacer" />
        <select value={theme} onChange={(e) => setTheme(e.target.value as "auto" | "light" | "dark")} title="theme">
          <option value="auto">system theme</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <button className="primary" onClick={share}>share link</button>
      </header>
      <ParamPanel p={cur} set={set} />
      <main className="main">
        <nav className="tabs">
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>)}
          <span className="muted small" style={{ alignSelf: "center", marginLeft: 8 }}>editing scenario {side}{B ? "" : " (add B to compare)"}</span>
        </nav>
        {banner && <div className="banner">{banner} <button onClick={() => setBanner(null)}>dismiss</button></div>}
        {tab === "overview" && <Overview p={deferred} r={result} issues={issues} onApply={setCur} />}
        {tab === "simulation" && <Simulation p={cur} mc={mc} onApply={setCur} />}
        {tab === "explore" && <Explore p={cur} onApply={setCur} />}
        {tab === "compare" && <Compare A={deferredA} B={deferredB} rA={resA} rB={resB} onMakeB={() => { setB(clone(A)); setSide("B"); }} />}
        {tab === "model" && <Model p={deferred} r={result} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
