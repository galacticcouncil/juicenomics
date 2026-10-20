import { useCallback, useEffect, useRef, useState } from "react";
import type { Params } from "../engine/params/types";
import { aggregate, type McRun } from "../engine/sim/aggregate";
import type { WorkerMessage } from "../worker/mc.worker";

const POOL = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

export function useMonteCarlo() {
  const workers = useRef<Worker[]>([]);
  const gen = useRef(0);
  const [run, setRun] = useState<McRun | null>(null);
  const [ranFor, setRanFor] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => workers.current.forEach((w) => w.terminate()), []);

  const start = useCallback((p: Params) => {
    const g = ++gen.current;
    workers.current.forEach((w) => w.terminate());
    workers.current = Array.from({ length: POOL }, () => new Worker(new URL("../worker/mc.worker.ts", import.meta.url), { type: "module" }));
    const total = Math.max(1, Math.round(p.sim.paths));
    const parts = workers.current.map((_, i) => Array.from({ length: total }, (_, j) => j).filter((j) => j % POOL === i));
    const done = new Array(POOL).fill(0);
    const results: { series: Float32Array; days: number; summary: McRun["summaries"][number]; index: number }[] = [];
    let finished = 0;
    const t0 = performance.now();
    setProgress(0);
    setError(null);
    workers.current.forEach((w, i) => {
      w.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.gen !== g) return;
        if (m.type === "progress") {
          done[i] = m.done;
          setProgress(done.reduce((a, b) => a + b, 0) / total);
        } else if (m.type === "error") {
          setError(m.message);
          setProgress(null);
        } else {
          results.push(...m.results);
          done[i] = parts[i].length;
          finished++;
          setProgress(done.reduce((a, b) => a + b, 0) / total);
          if (finished === POOL) {
            results.sort((a, b) => a.index - b.index);
            setRun(aggregate(results, performance.now() - t0));
            setRanFor(JSON.stringify(p));
            setProgress(null);
          }
        }
      };
      if (!parts[i].length) {
        finished++;
        return;
      }
      w.postMessage({ gen: g, params: p, paths: parts[i] });
    });
  }, []);

  return { run, ranFor, progress, error, start, workers: POOL };
}
