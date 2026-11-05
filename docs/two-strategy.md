# two-strategy carry preview

the new view estimates a fully funded, marginal position added to a pinned market. Main borrows HOLLAR against the depositor's collateral. its funding splits between PRIME collateral / HOLLAR debt and apyUSD collateral / PRIME debt. both strategies harvest into the vault's collateral through the proposed multi-asset harvester. one fee applies to positive combined carry after loop costs; Main interest is serviced afterwards.

the launch allocation is 100% legacy / 0% apyUSD. changing weights in this calculator compares future fully funded targets. it does not move existing positions or simulate a migration. ordinary funding and exits can gradually change the mix in the proposed source; this calculator does not model those transitions.

## pinned evidence

`src/data/two-strategy-market.json` is the unmodified mainnet snapshot from the source-upgrade study, captured on 5 november 2026:

- block `16630324`, hash `0x186cc98eec6dd15dda862cd92ec13d2147f80dfb275376a2ac6c7cc77dd23778`, runtime 458;
- two independent RPCs agree on the block and reserve balances; supply/debt residuals are zero;
- PRIME has 6 decimals and an oracle price of $1.06832328; apyUSD has 18 decimals and an oracle price of $1.3672318;
- PRIME borrowing uses the reserve curve: 0% base, 2% at 75% utilization, then another 20 percentage points to full utilization; reserve factor 20%;
- apyUSD's oracle was last updated on 17 september, PRIME is not borrowable in isolation, and apyUSD isolation debt is $1.529m against a $1m ceiling.

the view never presents these as fresh reads. positive apyUSD allocations remain visibly blocked and hypothetical. a later snapshot needs a new strategy-link version so existing links keep their economic assumptions. the first version's defaults and market are frozen for the same reason.

## accounting

for each strategy, leverage is `HF / (HF − liquidation threshold)`. net funding times leverage gives gross assets; the difference is loop debt. the legacy strategy adds PRIME reserve supply while the apyUSD strategy adds PRIME borrowing. both flows affect utilization, borrowing APR and supply APR. amounts are converted between USD and PRIME at its pinned price.

PRIME's native price growth increases both the legacy strategy's asset income and the apyUSD strategy's debt cost. apyUSD asset income includes its assumed native growth and pinned Aave supply rate. the initial 6.2% PRIME and 12.97% apyUSD growth assumptions come from the earlier carry study; they are not refreshed yield observations.

the blended fee is `max(0, legacy carry + apyUSD carry) × fee`. a loss in either strategy reduces the aggregate fee base. depositor carry is what remains after that fee and paid Main HOLLAR interest. protocol income combines the harvest fee, paid Main interest, paid legacy HOLLAR interest and the reserve-factor share of interest on the new PRIME debt. PRIME price appreciation is not protocol income. changes to income on existing reserve borrowers are excluded.

the default 90% legacy interest discount covers at most $5m of loop debt; the remainder pays the full rate. the marginal position is treated as a new source with that allowance available. this is not a replacement of a deployed position: a replacement study must first remove that position from the market baseline and account for any existing use of caps and discounts.

at $100k additional collateral, 75% Main LTV, legacy HF 1.05, apyUSD HF 1.30 and a 69% fee:

| apyUSD weight | depositor carry APR | monthly compounded APY | annual protocol income / TVL |
| --- | --- | --- | --- |
| 0% | 6.7819% | 6.9967% | 23.1935% |
| 25% | 6.0746% | 6.2466% | 21.2691% |
| 50% | 5.3488% | 5.4819% | 19.3079% |

`test/fixtures/two-strategy-economics.json` contains the independent source-study output behind these regressions. protocol income is not a compounded APY.

## scope and limits

the estimate excludes entry/exit execution costs, pool refill, gas, churn, oracle impairment, time-varying rates and native depositor collateral yield. positive allocations assume prerequisites are resolved while holding the pinned prices/rates fixed. pool 146 balances are shown as inventory context, not executable quotes. swaps through pools 143 and 146 need separate router-based evaluation. there is no simulated keeper response, capital ramp or active reallocation.

candidate gross/net exposure caps, PRIME borrow/supply caps, the apyUSD supply cap, legacy isolation ceiling, PRIME cash buffer and utilization ceiling flag oversized targets. failing targets are not silently clipped. capacity checks apply to this marginal position and do not establish deployed-source headroom, HOLLAR facilitator headroom or complete protocol readiness. apyUSD isolation is already blocked before new borrowing is considered. the rate curve caps at 22% when a hypothetical target exceeds full utilization; those positions cannot be funded.

the existing Overview, Simulation, Explore and Compare tabs retain their legacy Lark models. their pool-143 Monte Carlo does not evaluate apyUSD. their controls, stored settings and share-link era handling remain separate. the CLI refuses to pass a strategy link into the legacy engine.

## reproduce and publish

```sh
npm run sim -- strategies --weight 0.25 --fee 0.69 --pretty
npm run sim -- strategies --params
npm run sim -- strategies --tvl 500000 --set apyHf=1.5
npm run typecheck
npm run lint
npm test
VITE_DEFAULT_TAB=strategies npm run build
npm run preview -- --port 4173
SIM_URL=http://localhost:4173/ node scripts/smoke-strategies.mjs
SIM_URL=http://localhost:4173/ node scripts/smoke.mjs
```

after an authorized publish request and a clean commit, `scripts/publish-lark.sh two-strategy` builds the preview image, creates or updates only the `juicenomics-two-strategy` stack and verifies its revision/health. its hostname is `juicenomics-two-strategy.lark.hydration.cloud`; its tag is `<commit>-two-strategy`. production uses the separate `juicenomics` stack and `<commit>` tag. `DEPLOY_DRY_RUN=1` renders a validated deployment without reading credentials or calling Swarmpit.
