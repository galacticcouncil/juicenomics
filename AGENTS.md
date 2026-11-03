# juicenomics for agents

Run the simulator headlessly with `npm run sim -- <command>`. Every command prints one JSON document on stdout. Errors go to stderr with a non-zero exit. `npm run sim -- help` lists everything.

```sh
npm ci
npm run sim -- deployments                         # the chains a config can model: lark4 (default), lark0
npm run sim -- params --search leverage            # discover settings: path, url code, unit, range, lever, default, help
npm run sim -- cf --set loop.mode=lev --set loop.leverage=3
npm run sim -- mc --tvl 1000000 --set sim.initial=ramped --paths 96 --fields aprEth,aprBtc,stallHours
npm run sim -- search --tier today --tvl 500000 --set sim.initial=ramped --min-protocol 0.05 --min-liq 0.05 --no-stall --verify 32
npm run sim -- live --block 40000                   # chain state as a config + share link
npm run sim -- live --deployment lark0              # Lark 0's chain state: jETH on GIGAETH
npm run sim -- backtest [--deployment lark0]        # replay a deployment's history against the simulator
npm run sim -- hollar                               # HOLLAR supply, facilitator buckets, HSM inventory (mainnet)
npm run sim -- link 'https://juicenomics.lark.hydration.cloud/#s=2z…'   # decode a share link
```

## Building a config

Options apply in this order, and all of them are optional: `--deployment`, then `--preset`, `--link`, `--config file.json`, `--live [--block n]`, `--tvl usd` and `--set path=value` (repeatable).

- **Deployments:** `--deployment` picks whose settings and chain state a config starts from, and what `--live` and `backtest` read.
  - `lark4` (default): the 30 Oct refork runs jBTC alone (`vaults.eth.on=false`; `--preset jeth` adds jETH), with the 65/75/83 band, a 69% fee, 40% / 90% discounts and headroom exits.
  - `lark0`: the 2 Nov refork runs jETH alone on GIGAETH (`vaults.btc.on=false`; `--preset jbtc` adds jBTC). It has the same band, fee, discounts and headroom exits, a 100 GIGAETH cap and the Larks' 60 s withdrawal delay (mainnet: 7 days). Its entry lane caps at 35 bps and refills 10 HOLLAR / s, against Lark 4's 27 bps and 50 / s.
  - A preset, link or config from another deployment is an error, not a silent mix.

- **`--config` file:** either nested params, merged in, or a flat `{"path": value}` map.
- **`--tvl`:** scales the vaults that are on to a total TVL at today's split. Their chain positions scale with them, and the testnet caps come off.
- **Paths:** use the `path` field from `sim params`, e.g. `vaults.btc.bandLo`. Values are parsed against the parameter's kind.
- **Validation:** the result is validated. Clamped values and cross-field issues come back in `notes`.
- **Links:** every result includes `link`, which opens the same config in the web app for humans. Links are versioned: a v1 or v2 link (before the refork) opens with that era's settings, both vaults and no headroom exits. A link off Lark 4 carries its deployment (`dp`) and stores what differs from that deployment; a link without one is Lark 4's, as every older link is.

## What the numbers mean

- **Units:** rates and APRs are fractions per year (`0.05` = 5%). Costs ending in `Bps` are basis points vs the oracle. Money is USD. A `…Hours` field counts hours over the horizon.
- **APR:** share value growth in the vault's collateral units (GIGAETH, tBTC), as a log return over the horizon. A share is worth what an exit would return, net of the fee on unharvested surplus. A vault that's off reports `NaN` (dropped from `mc`).
- **Start (`sim.initial`):**
  - `fresh` (default): the whole TVL ramps at t = 0 and pays its entry, about c·L·ℓ ≈ 0.84% of TVL at the 1 bp pool fee, inside the horizon. It's repaid from carry before any fee, so depositors bear (1 − f) of it, ≈ 0.26%. At Lark 4's TVL the ramp needs ~590k PRIME, past the arb's 500k inventory: expect about a day of entry stalls.
  - `lark4`: starts from the chain's positions, on either deployment (the value kept its old name); that ramp was already paid.
  - `ramped`: steady state. Everything is at target, the hole is repaid. Compare long-run economics with this one.
- **`cf`** is the closed form: instant and steady state. Compare `vaults.*.horizonApr` with Monte Carlo APRs. `net` is the long-run rate.
- **`mc`** reports mean, standard error and p5…p95 for every numeric path field, plus `aprWorst`, the worse vault per path.
  - `conservationGapUsd`: depositor wealth change minus every recorded flow. It should be ~0 (about 1e-13 of PRIME yield).
  - `hollarDebt*`: HOLLAR the loop and vaults owe.
  - `arbHollarNetUsd`: HOLLAR the outside arbs collect from pool 143 and must sell somewhere. That's Juicer's HOLLAR sell pressure.
  - `deskHollarNetUsd`: what a treasury desk keeps instead.
  - Exits: `exitsUsd` withdrawn, `headroomExitsUsd` of it settled from headroom (pool these two across paths; `headroomExitShare` is per path and runs high when a path has few exits), `headroomKeptUsd` of loop the stayers kept, `exitWaitHours` from an exit's start to its collateral (headroom exits count zero), `reserveDrawnUsd`, and `ltvAvg*`.
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
- **`npx tsx scripts/fit-netting.mts`** refits the closed form's `NETTING` curve to the Monte Carlo (steady state at 1-50× TVL, the 65/75/83 band, a 2 bps pool fee). Rerun it after engine changes that touch trading costs, and keep the scale tests in `test/mc.test.ts` in step.
- **`npm run sim -- backtest`** samples a deployment's archive (Lark 4 unless `--deployment lark0`). It replays quiet stretches (hole closure, HF) and deposits (ramp cost) from the chain's own state.
  - On 21 Oct the hole closure matched to −2.2% and HF to 4 decimals.
  - Deposit ramps matched to 147.2–147.9 vs 147.8–147.9 bps of principal.
- **Default quiet stretches:** before trusting a result, check that `stallHours`, `unwindStallHours` and `arbDryHours` are small, `stopHours*` = 0 and `minHf` > 1.02.

## Gotchas

- **Allowance gap:** the closed form leaves out the execution-cost allowance, the share of the gross PRIME kept as surplus: 27 bps on Lark 4 (≈ 160 bps of principal), 35 on Lark 0 (≈ 210). The Monte Carlo includes it and runs about 0.15 pp higher on Lark 4 and 0.3 on Lark 0 at a flat median price, more on paths where collateral falls.
- **Small TVL:** below Lark 4's TVL the closed form runs another ~0.15 pp under the Monte Carlo, for either vault: the `NETTING` fit starts at 1×. Lark 0, mid-ramp, sits there.
- **GIGAETH:** pool 4200's share (aETH and wstETH), priced as ETH/USD × the pool's share rate. It moves with ETH (57% vol) and gained 1.5% on ETH over the last year: `inKindYield`, shown beside the APR, which is in GIGAETH and leaves it out. Depositors buy it outside the vault (Lark 0's $100k depositor paid ~1.4 bps over the oracle with ETH); the sim doesn't charge for that, for either collateral.
- **Lark 0's lane:** entries refill at 10 HOLLAR / s, so a deposit ramps in at most 36k of PRIME an hour, about 12 h for its $100k depositor. Lark 4's binding limit is the 2,500-a-minute pacing, 150k an hour.
- **Headroom exits:** an exit settles without selling while the vault's LTV after it stays ≤ max LTV − gap; the stayers keep its debt, so their LTV rises and later delevers sell part of what was spared. Big exits on a small vault don't fit: at Lark 4's TVL a quarter of withdrawal dollars settle from headroom, at $2M about 80%. The closed form's share tracks the Monte Carlo's pooled share within ~0.05.
- **Loop discount cap:** the 90% loop discount covers 5M HOLLAR of loop debt; past ~$1.5M TVL the rest pays the full rate.
- **Scale:** pool 143 (~$1.07M) and the arb's 500k PRIME inventory don't grow with TVL. Past ~$1M TVL trading costs and stalls rise; use `pool.depth`, the desk, or lower leverage.
- **HOLLAR:** each $1 deposited borrows about L·ℓ HOLLAR, all of it sold for PRIME. `market.hollarHeadroomUsd` defaults to the mainnet facilitator's headroom (2.13M on 21 Oct), and the closed form flags configs that exceed it.
- **Growth:** `flows.growth` grows TVL in dollars, so falling prices slow it in the Monte Carlo. The closed form grows it at today's prices.
- **Publishing:** `scripts/publish-lark.sh` deploys the web app. Only run it when a human asked for a deploy.
