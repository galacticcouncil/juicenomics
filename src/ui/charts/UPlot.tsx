import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface Series {
  label: string;
  color: string;
  width?: number;
  dash?: number[];
  fill?: string;
  value?: (v: number) => string;
}

export interface Band {
  /** series indexes (1-based, as in uPlot) of the upper and lower edges */
  upper: number;
  lower: number;
  fill: string;
}

function cssVar(name: string): string {
  if (!name.startsWith("var(")) return name;
  return getComputedStyle(document.documentElement).getPropertyValue(name.slice(4, -1)).trim() || "#888";
}

/** thin uPlot wrapper: time or numeric x, crosshair tooltip via the built-in legend */
export function Chart({ data, series, bands, height = 240, xLabel, yFmt, xFmt, time = false, hLines = [] }: {
  data: (number | null)[][];
  series: Series[];
  bands?: Band[];
  height?: number;
  xLabel?: string;
  yFmt?: (v: number) => string;
  xFmt?: (v: number) => string;
  time?: boolean;
  hLines?: { y: number; color: string; label: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const axisColor = cssVar("var(--text-secondary)");
    const grid = cssVar("var(--border)");
    const opts: uPlot.Options = {
      width: el.clientWidth || 600,
      height,
      scales: { x: { time } },
      cursor: { drag: { x: true, y: false } },
      legend: { live: true },
      axes: [
        { stroke: axisColor, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, label: xLabel, values: xFmt ? (_u, vals) => vals.map((v) => xFmt(v)) : undefined },
        { stroke: axisColor, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 64, values: yFmt ? (_u, vals) => vals.map((v) => yFmt(v)) : undefined },
      ],
      series: [
        { label: xLabel ?? "x", value: xFmt ? (_u, v) => (v == null ? "—" : xFmt(v)) : undefined },
        ...series.map((s) => ({
          label: s.label,
          stroke: cssVar(s.color),
          width: s.width ?? 2,
          dash: s.dash,
          fill: s.fill ? cssVar(s.fill) : undefined,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : s.value ? s.value(v) : yFmt ? yFmt(v) : String(v)),
        })),
      ],
      bands: bands?.map((b) => ({ series: [b.upper, b.lower] as [number, number], fill: cssVar(b.fill) })),
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            for (const h of hLines) {
              const yy = u.valToPos(h.y, "y", true);
              if (!Number.isFinite(yy)) continue;
              ctx.save();
              ctx.strokeStyle = cssVar(h.color);
              ctx.setLineDash([5, 4]);
              ctx.lineWidth = 1.5 * devicePixelRatio;
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yy);
              ctx.lineTo(u.bbox.left + u.bbox.width, yy);
              ctx.stroke();
              ctx.fillStyle = cssVar(h.color);
              ctx.font = `${11 * devicePixelRatio}px system-ui`;
              ctx.fillText(h.label, u.bbox.left + 6 * devicePixelRatio, yy - 4 * devicePixelRatio);
              ctx.restore();
            }
          },
        ],
      },
    };
    const plot = new uPlot(opts, data as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [data, series, bands, height, xLabel, yFmt, xFmt, time, hLines]);
  return <div ref={ref} className="chart" />;
}
