# juicenomics

Formerly juicer-sim; `https://juicer-sim.lark.hydration.cloud` links redirect here.

Economics dashboard for Juicer, Hydration's leveraged PRIME loop vaults: jBTC on tBTC and jETH on GIGAETH.

The **Two strategies** tab compares PRIME / HOLLAR and apyUSD / PRIME with HOLLAR Main debt and one blended harvest fee. It starts at 100% legacy / 0% apyUSD, models marginal new funding without active reallocation, and exposes the pinned market blockers and capacity checks alongside the estimates. Its settings, share links and JSON export are separate from the legacy Lark simulations. See [the model and snapshot scope](docs/two-strategy.md).

The **vDOT / DOT** tab models borrowing DOT against original vault collateral, buying vDOT, then supplying vDOT to borrow more DOT. Both loans use an editable DOT borrow APR or the reserve curve. Defaults are 69% fee and loop HF 1.01, with borrowing-limit violations flagged. It shows each borrowing account's HF, fee comparisons and real DOT/vDOT router quotes. This design requires changes to the deployed HOLLAR-bound Main ledger. [Dedicated preview](https://juicenomics-vdot.lark.hydration.cloud/#t=vdot), [model, compatibility and evidence](docs/vdot-dot.md); headless: `npm run sim -- vdot`.

- **What it covers:** every protocol, market and improvement setting has a control. The header picks the deployment a scenario models; presets, resets, share links and live state follow it.
  - **Lark 4** (default): the 30 Oct refork runs jBTC alone, so jETH starts switched off.
  - **Lark 0:** the 2 Nov refork runs jETH alone on GIGAETH, launched through the mainnet path, so jBTC starts switched off. Same band, fee, discounts and headroom exits; its entry lane caps at 35 bps and refills at 10 HOLLAR / s (Lark 4: 27 bps, 50 / s).
  - A config is shareable as a link. Links from before the 30 Oct refork open with their own era's settings.
- **Closed form:** the Overview, Explore and Compare tabs recompute on every change. It covers:
  - net APR per vault, break-even, leverage and liquidation distance;
  - the structural deficit and the deposit gates;
  - protocol revenue and who gets the PRIME yield;
  - rebalance churn from band geometry, with buys and sells netting out in pool 143;
  - the share of exits that settle from LTV headroom, and the leverage that shifts to the holders who stay.
- **Monte Carlo:** the Simulation tab runs it in web workers.
  - It steps hourly through pool 143's stableswap math (float mirror or Hydration's wasm) with an outside arb that has finite inventory.
  - It also models keeper rebalances, harvests with Main interest servicing, deposit stops, lane pacing, flows, and headroom exits with the protocol reserve behind their shortfalls.
  - It reports fans, distributions and per-cohort returns.
- **Explore:** a sweep, a two-setting heatmap, sensitivity bars, and a constrained search with a depositor vs protocol Pareto front.

Model estimates only. Sources and conventions are in the app's Model tab and in the garden note `wiki/note-juicer-loop-cost-study-2026-10-20`.

```sh
npm ci
npm run dev            # local app
npm test               # closed form vs the study, pool parity with the wasm, monte carlo checks, share links
npm run build
node scripts/snapshot-lark.mjs lark4   # refresh a deployment's settings, lark4 or lark0 (read-only chain reads)
SIM_URL=http://localhost:4173/ node scripts/smoke.mjs   # headless check of a running build
```

Headless, for scripts and agents: `npm run sim -- help`. Every command prints JSON, covering the closed form, a parallel Monte Carlo, search, live or archived chain state, share links, a backtest against either deployment's history and HOLLAR supply. `--deployment lark0` models Lark 0. See [AGENTS.md](AGENTS.md).

CI checks lint, tests and the build. Publishing is manual from a Docker host logged in to Docker Hub: `scripts/publish-lark.sh` builds and pushes `galacticcouncil/juicenomics:<commit>`, then updates the `juicenomics` Swarmpit stack on lark. It reads the Swarmpit token from `SWARMPIT_TOKEN_FILE` (default `~/.lark_token`) and waits until `https://juicenomics.lark.hydration.cloud` serves the commit.

`scripts/publish-lark.sh two-strategy` creates or updates the separate `juicenomics-two-strategy` stack at **https://juicenomics-two-strategy.lark.hydration.cloud**, opening on the new tab. It uses a `<commit>-two-strategy` image tag and dedicated router/service names; production and its legacy redirect keep their existing stack. Both targets verify `/version.txt` and `/healthz` after deployment.
