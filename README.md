# juicenomics

Formerly juicer-sim; `https://juicer-sim.lark.hydration.cloud` links redirect here.

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

Headless, for scripts and agents: `npm run sim -- help`. Every command prints JSON, covering the closed form, a parallel Monte Carlo, search, live or archived chain state, share links, a Lark 4 backtest and HOLLAR supply. See [AGENTS.md](AGENTS.md).

CI checks lint, tests and the build. Publishing is manual from a Docker host logged in to Docker Hub: `scripts/publish-lark.sh` builds and pushes `galacticcouncil/juicenomics:<commit>`, then updates the `juicenomics` Swarmpit stack on lark. It reads the Swarmpit token from `SWARMPIT_TOKEN_FILE` (default `~/.lark_token`) and waits until `https://juicenomics.lark.hydration.cloud` serves the commit.
