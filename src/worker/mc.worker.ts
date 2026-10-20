/// <reference lib="webworker" />
import type { Params } from "../engine/params/types";
import type { StableswapWasm } from "../engine/pool/pool";
import { runPath, type PathResult } from "../engine/sim/mc";

export interface RunRequest {
  gen: number;
  params: Params;
  paths: number[];
}

export type WorkerMessage =
  | { type: "progress"; gen: number; done: number }
  | { type: "result"; gen: number; results: { index: number; series: Float32Array; days: number; summary: PathResult["summary"] }[] }
  | { type: "error"; gen: number; message: string };

let math: StableswapWasm | undefined;

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { gen, params, paths } = e.data;
  try {
    if (params.sim.poolMode === "exact" && !math) math = (await import("@galacticcouncil/math-stableswap")) as unknown as StableswapWasm;
    const results: { index: number; series: Float32Array; days: number; summary: PathResult["summary"] }[] = [];
    let last = performance.now();
    for (const index of paths) {
      const r = runPath(params, index, math);
      results.push({ index, ...r });
      if (performance.now() - last > 150) {
        (self as DedicatedWorkerGlobalScope).postMessage({ type: "progress", gen, done: results.length } satisfies WorkerMessage);
        last = performance.now();
      }
    }
    (self as DedicatedWorkerGlobalScope).postMessage(
      { type: "result", gen, results } satisfies WorkerMessage,
      results.map((r) => r.series.buffer),
    );
  } catch (error) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: "error", gen, message: (error as Error).message } satisfies WorkerMessage);
  }
};
