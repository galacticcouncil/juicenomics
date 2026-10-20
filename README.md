# juicer-sim

Economics dashboard for Juicer, Hydration's leveraged PRIME loop vaults (jETH, jBTC).

- **What it covers:** every protocol, market and improvement setting has a control. Defaults are the live Lark 4 configuration. A config is shareable as a link.
- **Closed form:** the Overview, Explore and Compare tabs recompute on every change. It covers:
  - net APR per vault, break-even, leverage and liquidation distance;
  - the structural deficit and the deposit gates;
  - protocol revenue and who gets the PRIME yield;
  - rebalance churn from band geometry, with buys and sells netting out in pool 143.
- **Monte Carlo:** the Simulation tab runs it in web workers.
  - It steps hourly through pool 143's stableswap math (float mirror or Hydration's wasm) with an outside arb that has finite inventory.
  - It also models keeper rebalances, harvests with Main interest servicing, deposit stops and flows.
  - It reports fans, distributions and per-cohort returns.
- **Explore:** a sweep, a two-setting heatmap, sensitivity bars, and a constrained search with a depositor vs protocol Pareto front.

Model estimates only. Sources and conventions are in the app's Model tab and in the garden note `wiki/note-juicer-loop-cost-study-2026-10-20`.

```sh
npm ci
npm run dev            # local app
npm test               # closed form vs the study, pool parity with the wasm, monte carlo checks, share links
npm run build
node scripts/snapshot-lark4.mjs   # refresh the Lark 4 defaults (read-only chain reads)
SIM_URL=http://localhost:4173/ node scripts/smoke.mjs   # headless check of a running build
```

Every push to `main` builds `galacticcouncil/juicer-sim`, updates the `juicer-sim` Swarmpit stack on lark and waits for `https://juicer-sim.lark.hydration.cloud` to serve the commit.
