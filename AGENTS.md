# juicenomics for agents

Run the simulator headlessly with `npm run sim -- <command>`. Every command prints one JSON document on stdout. Errors go to stderr with a non-zero exit. `npm run sim -- help` lists everything.

```sh
npm ci
npm run sim -- params --search leverage            # discover settings: path, url code, unit, range, lever, default, help
npm run sim -- cf --set loop.mode=lev --set loop.leverage=3
npm run sim -- mc --tvl 1000000 --set sim.initial=ramped --paths 96 --fields aprEth,aprBtc,stallHours
npm run sim -- search --tier today --tvl 500000 --set sim.initial=ramped --min-protocol 0.05 --min-liq 0.05 --no-stall --verify 32
npm run sim -- live --block 40000                   # chain state as a config + share link
npm run sim -- backtest                             # replay Lark 4 history against the simulator
npm run sim -- hollar                               # HOLLAR supply, facilitator buckets, HSM inventory (mainnet)
npm run sim -- link 'https://juicenomics.lark.hydration.cloud/#s=2z…'   # decode a share link
```

## Building a config

Options apply in this order, and all of them are optional: `--preset`, then `--link`, `--config file.json`, `--live [--block n]`, `--tvl usd` and `--set path=value` (repeatable). The defaults are Lark 4's settings.

- **`--config` file:** either nested params, merged in, or a flat `{"path": value}` map.
- **`--tvl`:** scales both vaults to a total TVL at today's split. Their chain positions scale with them, and the testnet caps come off.
- **Paths:** use the `path` field from `sim params`, e.g. `vaults.btc.bandLo`. Values are parsed against the parameter's kind.
- **Validation:** the result is validated. Clamped values and cross-field issues come back in `notes`.
- **Links:** every result includes `link`, which opens the same config in the web app for humans.

## What the numbers mean

- **Units:** rates and APRs are fractions per year (`0.05` = 5%). Costs ending in `Bps` are basis points vs the oracle. Money is USD. A `…Hours` field counts hours over the horizon.
- **APR:** share value growth in the vault's collateral units (GIGAETH, tBTC), as a log return over the horizon.
- **Start (`sim.initial`):**
  - `fresh` (default): the whole TVL ramps at t = 0 and pays its entry, about c·L·ℓ ≈ 1.2% of TVL, inside the horizon.
  - `lark4`: starts from the chain's positions; that ramp was already paid.
  - `ramped`: steady state. Everything is at target, the hole is repaid. Compare long-run economics with this one.
- **`cf`** is the closed form: instant and steady state. Compare `vaults.*.horizonApr` with Monte Carlo APRs. `net` is the long-run rate.
- **`mc`** reports mean, standard error and p5…p95 for every numeric path field, plus `aprWorst`, the worse vault per path.
  - `conservationGapUsd`: depositor wealth change minus every recorded flow. It should be ~0 (about 1e-13 of PRIME yield).
  - `hollarDebt*`: HOLLAR the loop and vaults owe.
  - `arbHollarNetUsd`: HOLLAR the outside arbs collect from pool 143 and must sell somewhere. That's Juicer's HOLLAR sell pressure.
  - `deskHollarNetUsd`: what a treasury desk keeps instead.
- **Speed (32-core box, 21 Oct):** about 0.8 ms per path-day per core with the fast pool at today's TVL, and ~3 ms at $5M, which trades more. 64 one-year paths take ~1.2 s on 16 workers. `--exact` uses Hydration's wasm pool, about 2.5× slower.
- **Determinism:** path i always uses seed (`sim.seed`, i), so a run reproduces whatever the worker count. Change `sim.seed` for an independent sample.

## Validating

- **`npm run typecheck`** covers the app and these scripts.
- **`npm test`** covers:
  - closed form vs the study;
  - fast pool vs wasm (quotes, reserves, a full path);
  - Monte Carlo vs closed form, and conservation across configs;
  - both review regression sets;
  - share links and the CLI.
- **`npm run sim -- backtest`** samples Lark 4's archive. It replays quiet stretches (hole closure, HF) and deposits (ramp cost) from the chain's own state.
  - On 21 Oct the hole closure matched to −2.2% and HF to 4 decimals.
  - Deposit ramps matched to 147.2–147.9 vs 147.8–147.9 bps of principal.
- **Default quiet stretches:** before trusting a result, check that `stallHours`, `unwindStallHours` and `arbDryHours` are small, `stopHours*` = 0 and `minHf` > 1.02.

## Gotchas

- **Allowance gap:** the closed form leaves out the execution-cost allowance, ≈ 27 bps of the gross PRIME (≈ 160 bps of principal) kept as surplus. The Monte Carlo includes it and runs about 0.3 pp higher at a flat median price, more on paths where collateral falls.
- **Scale:** pool 143 (~$1.07M) and the arb's 500k PRIME inventory don't grow with TVL. Past ~$1M TVL trading costs and stalls rise; use `pool.depth`, the desk, or lower leverage.
- **HOLLAR:** each $1 deposited borrows about L·ℓ HOLLAR, all of it sold for PRIME. `market.hollarHeadroomUsd` defaults to the mainnet facilitator's headroom (2.13M on 21 Oct), and the closed form flags configs that exceed it.
- **Growth:** `flows.growth` grows TVL in dollars, so falling prices slow it in the Monte Carlo. The closed form grows it at today's prices.
- **Publishing:** `scripts/publish-lark.sh` deploys the web app. Only run it when a human asked for a deploy.
