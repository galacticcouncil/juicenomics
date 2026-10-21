import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import type { Params } from "../src/engine/params/types";
import type { StableswapWasm } from "../src/engine/pool/pool";
import { runPath } from "../src/engine/sim/mc";

parentPort!.on("message", (m: { params: Params; indices: number[]; series: boolean; exact: boolean }) => {
  try {
    // the package's node build; the browser loads the same wasm through vite
    const math = m.exact ? (createRequire(import.meta.url)("@galacticcouncil/math-stableswap/build/index.cjs") as StableswapWasm) : undefined;
    const params = { ...m.params, sim: { ...m.params.sim, poolMode: m.exact ? ("exact" as const) : ("fast" as const) } };
    for (const i of m.indices) {
      const r = runPath(params, i, math);
      parentPort!.postMessage({ i, summary: r.summary, series: m.series ? r.series : undefined, days: r.days });
    }
    parentPort!.postMessage({ done: true });
  } catch (e) {
    parentPort!.postMessage({ error: (e as Error).stack ?? String(e) });
  }
});
