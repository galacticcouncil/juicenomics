import { useState, type ReactNode } from "react";
import type { Step } from "../../engine/model/closedForm";
import { fmtPct } from "../fmt";

// shared hover tooltip for the svg charts
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = (e: React.MouseEvent, text: string) => {
    const r = (e.currentTarget as Element).closest("svg")?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const node: ReactNode = tip ? (
    <div className="svgtip" style={{ left: tip.x + 12, top: tip.y - 10 }}>{tip.text}</div>
  ) : null;
  return { show, hide: () => setTip(null), node };
}

/** waterfall of per-year rates; start and total bars carry identity, deductions stay neutral */
export function Waterfall({ steps, color = "var(--series-1)", height = 220, fmt = (v: number) => fmtPct(v) }: { steps: Step[]; color?: string; height?: number; fmt?: (v: number) => string }) {
  const tip = useTip();
  const W = 560;
  const pad = { l: 8, r: 8, t: 16, b: 46 };
  const bars = steps.reduce<(Step & { from: number; to: number })[]>((acc, s) => {
    const run = acc.length ? acc[acc.length - 1].to : 0;
    const absolute = s.kind === "start" || s.kind === "total";
    acc.push({ ...s, from: absolute ? 0 : run, to: absolute ? s.value : run + s.value });
    return acc;
  }, []);
  const max = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const min = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const span = max - min || 1;
  const bw = (W - pad.l - pad.r) / bars.length;
  const y = (v: number) => pad.t + ((max - v) / span) * (height - pad.t - pad.b);
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="waterfall">
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        {bars.map((b, i) => {
          const top = Math.min(y(b.from), y(b.to));
          const h = Math.max(1, Math.abs(y(b.from) - y(b.to)));
          const fill = b.kind === "sub" ? "var(--neutral)" : b.kind === "total" ? (b.value >= 0 ? "var(--series-3)" : "var(--div-neg)") : color;
          const x = pad.l + i * bw + 6;
          return (
            <g key={b.label} onMouseMove={(e) => tip.show(e, `${b.label}: ${fmt(b.value)}`)} onMouseLeave={tip.hide}>
              <rect x={x} y={top} width={bw - 12} height={h} rx={3} fill={fill} />
              <text className="val" x={x + (bw - 12) / 2} y={top - 4} textAnchor="middle">{fmt(b.value)}</text>
              <text x={x + (bw - 12) / 2} y={height - pad.b + 14} textAnchor="middle">
                {b.label.split(" ").reduce<string[]>((lines, w) => {
                  const last = lines[lines.length - 1];
                  if (last && (last + " " + w).length <= 14) lines[lines.length - 1] = last + " " + w;
                  else lines.push(w);
                  return lines;
                }, []).map((line, j) => <tspan key={j} x={x + (bw - 12) / 2} dy={j ? 12 : 0}>{line}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  color: string;
}

/** one horizontal stacked bar of shares, with a legend and direct labels on wide segments */
export function StackBar({ segments, fmt }: { segments: Segment[]; fmt: (v: number) => string }) {
  const tip = useTip();
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((a, s) => a + s.value, 0) || 1;
  const W = 560;
  const starts = parts.map((_, i) => (parts.slice(0, i).reduce((a, s) => a + s.value, 0) / total) * W);
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} 34`} width="100%" role="img" aria-label="split">
        {parts.map((s, i) => {
          const w = (s.value / total) * W;
          const x = starts[i];
          return (
            <g key={s.label} onMouseMove={(e) => tip.show(e, `${s.label}: ${fmt(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`)} onMouseLeave={tip.hide}>
              <rect x={x + 1} y={4} width={Math.max(0, w - 2)} height={26} rx={3} fill={s.color} />
              {w > 70 && <text x={x + w / 2} y={21} textAnchor="middle" style={{ fill: "#fff" }}>{((s.value / total) * 100).toFixed(0)}%</text>}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.label}><span className="sw" style={{ background: s.color }} />{s.label} <b>{fmt(s.value)}</b></span>
        ))}
      </div>
      {tip.node}
    </div>
  );
}

export interface TornadoRow {
  label: string;
  lo: number;
  hi: number;
  loLabel: string;
  hiLabel: string;
}

/** sensitivity bars around a base value */
export function Tornado({ rows, base, fmt }: { rows: TornadoRow[]; base: number; fmt: (v: number) => string }) {
  const tip = useTip();
  const W = 560;
  const lw = 190;
  const rh = 24;
  const H = rows.length * rh + 30;
  const vals = rows.flatMap((r) => [r.lo, r.hi]).concat(base);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (v: number) => lw + ((v - min) / span) * (W - lw - 70);
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="sensitivity">
        <line x1={x(base)} x2={x(base)} y1={4} y2={H - 22} stroke="var(--text-muted)" strokeDasharray="3 3" />
        <text x={x(base)} y={H - 8} textAnchor="middle">base {fmt(base)}</text>
        {rows.map((r, i) => {
          const yy = 8 + i * rh;
          const a = Math.min(r.lo, r.hi);
          const b = Math.max(r.lo, r.hi);
          return (
            <g key={r.label}>
              <text x={lw - 8} y={yy + 13} textAnchor="end">{r.label}</text>
              <rect x={x(Math.min(base, r.lo))} y={yy + 2} width={Math.max(1, Math.abs(x(r.lo) - x(base)))} height={rh - 8} rx={3} fill="var(--series-2)"
                onMouseMove={(e) => tip.show(e, `${r.label} ${r.loLabel}: ${fmt(r.lo)}`)} onMouseLeave={tip.hide} />
              <rect x={x(Math.min(base, r.hi))} y={yy + 2} width={Math.max(1, Math.abs(x(r.hi) - x(base)))} height={rh - 8} rx={3} fill="var(--series-1)"
                onMouseMove={(e) => tip.show(e, `${r.label} ${r.hiLabel}: ${fmt(r.hi)}`)} onMouseLeave={tip.hide} />
              <text className="val" x={x(b) + 4} y={yy + 13}>{fmt(b === r.hi ? r.hi : r.lo)}</text>
              <text className="val" x={x(a) - 4} y={yy + 13} textAnchor="end" style={{ display: x(a) - lw > 44 ? undefined : "none" }}>{fmt(a === r.lo ? r.lo : r.hi)}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend"><span><span className="sw" style={{ background: "var(--series-2)" }} />parameter at its low end</span><span><span className="sw" style={{ background: "var(--series-1)" }} />at its high end</span></div>
      {tip.node}
    </div>
  );
}

/** grid of a metric over two parameters; sequential blue, infeasible cells hatched */
export function Heatmap({ xs, ys, z, xLabel, yLabel, fmt, fmtX, fmtY, current, onPick }: {
  xs: number[]; ys: number[]; z: (number | null)[][]; xLabel: string; yLabel: string;
  fmt: (v: number) => string; fmtX: (v: number) => string; fmtY: (v: number) => string;
  current?: { x: number; y: number }; onPick?: (x: number, y: number) => void;
}) {
  const tip = useTip();
  const W = 560;
  const H = 380;
  const pad = { l: 62, r: 10, t: 10, b: 46 };
  const cw = (W - pad.l - pad.r) / xs.length;
  const ch = (H - pad.t - pad.b) / ys.length;
  const flat = z.flat().filter((v): v is number => v != null && Number.isFinite(v));
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const ramp = ["var(--seq-0)", "var(--seq-1)", "var(--seq-3)", "var(--seq-5)", "var(--seq-7)", "var(--seq-9)"];
  const color = (v: number) => ramp[Math.min(ramp.length - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo || 1)) * ramp.length)))];
  const tick = (n: number, i: number) => i % Math.ceil(n / 6) === 0;
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="heatmap">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--neutral)" strokeWidth="2" />
          </pattern>
        </defs>
        {ys.map((yv, j) => xs.map((xv, i) => {
          const v = z[j][i];
          return (
            <rect key={`${i}-${j}`} x={pad.l + i * cw} y={pad.t + (ys.length - 1 - j) * ch} width={cw - 1} height={ch - 1}
              fill={v == null || !Number.isFinite(v) ? "url(#hatch)" : color(v)} style={{ cursor: onPick ? "pointer" : undefined }}
              onMouseMove={(e) => tip.show(e, `${xLabel} ${fmtX(xv)}, ${yLabel} ${fmtY(yv)}: ${v == null ? "infeasible" : fmt(v)}`)}
              onMouseLeave={tip.hide} onClick={() => onPick?.(xv, yv)} />
          );
        }))}
        {xs.map((xv, i) => tick(xs.length, i) && <text key={i} x={pad.l + i * cw + cw / 2} y={H - pad.b + 14} textAnchor="middle">{fmtX(xv)}</text>)}
        {ys.map((yv, j) => tick(ys.length, j) && <text key={j} x={pad.l - 6} y={pad.t + (ys.length - 1 - j) * ch + ch / 2 + 4} textAnchor="end">{fmtY(yv)}</text>)}
        <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 8} textAnchor="middle">{xLabel}</text>
        <text x={14} y={pad.t + (H - pad.t - pad.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${pad.t + (H - pad.t - pad.b) / 2})`}>{yLabel}</text>
        {current && (() => {
          const i = xs.reduce((best, v, k) => (Math.abs(v - current.x) < Math.abs(xs[best] - current.x) ? k : best), 0);
          const j = ys.reduce((best, v, k) => (Math.abs(v - current.y) < Math.abs(ys[best] - current.y) ? k : best), 0);
          return <rect x={pad.l + i * cw - 1} y={pad.t + (ys.length - 1 - j) * ch - 1} width={cw + 1} height={ch + 1} fill="none" stroke="var(--series-2)" strokeWidth={2} />;
        })()}
      </svg>
      <div className="legend">
        <span>{fmt(lo)}</span>
        {ramp.map((c) => <span key={c} className="sw" style={{ background: c, width: 22 }} />)}
        <span>{fmt(hi)}</span>
        <span><span className="sw" style={{ background: "var(--neutral)" }} />hatched: infeasible</span>
        <span><span className="sw" style={{ border: "2px solid var(--series-2)", background: "transparent" }} />current</span>
      </div>
      {tip.node}
    </div>
  );
}
