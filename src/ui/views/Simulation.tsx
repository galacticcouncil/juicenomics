import type { Params } from "../../engine/params/types";

export function Simulation({ p }: { p: Params }) {
  return <div className="card"><p>Monte Carlo for {p.sim.paths} paths is being wired up.</p></div>;
}
