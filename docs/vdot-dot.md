# vDOT / DOT alternative

this preview replaces the PRIME/HOLLAR source with a vDOT-collateral / DOT-debt loop for marginal new funding. Main still borrows HOLLAR against the original vault collateral. the comparison starts with $100k new collateral, 75% Main LTV, DOT eMode, HF 1.01 and a 69% harvest fee. the requested HF exceeds the current borrowing LTV; the preview flags that constraint and shows theoretical carry. it models economics only: no strategy contract, keeper integration, governance change or active reallocation is included.

the flow is HOLLAR → vDOT, supply vDOT, borrow DOT, swap to more vDOT and supply again. an eventual unwind would repay DOT and return HOLLAR to the source. this would require its own Aave account, a vDOT-capable harvester, truthful USD backing and explicit treatment of DOT equity exposure; the preview does not claim that those contract paths exist.

the dedicated deployment is [juicenomics-vdot.lark.hydration.cloud](https://juicenomics-vdot.lark.hydration.cloud/). it opens this model by default and uses its own stack, router and `-vdot` image tag. `scripts/publish-lark.sh vdot` targets it; production and the two-strategy preview have separate targets.

## compatibility with deployed contracts

the two borrowing layers are distinct:

| layer | current live strategy | this preview |
| --- | --- | --- |
| vault / Main | HOLLAR debt | HOLLAR debt |
| yield-source loop | PRIME collateral / HOLLAR debt | vDOT collateral / DOT debt |

the vDOT supplied inside the strategy would borrow DOT. the original deposit does not change Main's debt currency. this is not a configuration supported by the currently deployed source: SubLoop and its logic are PRIME/HOLLAR-specific, including 6/18-decimal conversions, and the current harvester accepts PRIME.

a compatible source upgrade can be designed around the existing vault and Main ledger only if it preserves the HOLLAR-in/HOLLAR-out settlement boundary, USD8 equity, source shares, pending exits, ownership and continuous execution-cost counters. it needs a vDOT/DOT strategy, a suitable harvest path, keeper support and an exact upgrade rehearsal. this preview provides none of those contract implementations or compatibility proofs.

making **Main itself borrow DOT** is a different design. deployed `JuicerMainDebt.hollar` and `debtToken` are immutable; `CollateralVault.setMainDebt` rejects replacing a ledger once one is attached. Main borrowing also uses USD8-to-HOLLAR18 conversions. DOT has 10 decimals and a floating USD price, so renaming the token or changing a route cannot make those semantics correct. that path requires a denomination-aware Main ledger and reviewed vault, repayment, fee/discount and settlement integration, with a new deployment or explicit migration design. the carry and price-shock figures here do not model it.

[live binding and code-hash evidence](evidence/vdot-compatibility.json) compares the deployed source, vault, Main ledger, helper and harvester with the launch manifest on two independent RPCs. reproduce with `node scripts/check-vdot-compatibility.mjs /path/to/mainnet/manifest.json /tmp/vdot-compatibility.json`.

## evidence

`src/data/vdot-market.json` pins mainnet block **16706517**, **6 november 2026, 23:11:00 UTC**, hash `0x95fc79bfdb3d780b1839ece009bd62cb9e89d12d11f2afe99de715f9a3334683`. both reserve supplies and variable debts agree on two independent RPCs with zero residuals. registry decimals, reserve configuration, rate curves, oracle sources and pool 690 balances are read from chain.

| input | pinned value |
| --- | --- |
| DOT / vDOT assets | 5 / 15; both 10 decimals |
| prices | DOT $0.91825381; vDOT $1.53278548 |
| reserve status | both active, unfrozen and unpaused; DOT borrowing enabled; vDOT not isolated |
| eMode | category 2, 85% max borrowing LTV, 92% liquidation threshold, asset-specific prices |
| standard vDOT collateral | 60% max LTV, 70% liquidation threshold |
| DOT rate curve | 0 base; 2.75% at 85% utilization; 49.5% at full utilization; 10% reserve factor |
| DOT reserve | ~4.399m supplied, ~2.279m borrowed, ~2.120m cash; 17m borrow cap, 25m supply cap |
| vDOT reserve | ~965.5k supplied; 2,222,222 supply cap |
| pool 690 | ~1.168m vDOT and ~1.787m aDOT |

the minimum borrowable HF in eMode is `0.92 / 0.85 = 1.08235294`, even though liquidation starts at HF 1. the requested default HF 1.01 gives 11.2222× leverage and 91.0891% loop LTV, exceeding the 85% borrow limit. its $841,666.67 gross exposure also exceeds the unchanged $500k candidate cap. the original HF 1.15 reference gives 5× leverage and 80% loop LTV. standard mode uses its own thresholds and minimum HF, `0.70 / 0.60`.

the staking assumption comes from the on-chain Bifrost DOT-per-vDOT feed, not vDOT/USD. between blocks 15525295 and 16706517, exactly 30 days elapsed and the exchange rate increased from **1.66325910** to **1.66923945 DOT/vDOT**. the 0.359556% window return annualizes linearly to **4.374600% APR**. this is backward-looking native growth, already reflected in the exchange rate; staking fees are not deducted again. no incentive rewards are added. [Bifrost explains the exchange-rate mechanism](https://docs.bifrost.io/faq/what-are-vtokens/vdot) and [leveraged staking](https://docs.bifrost.io/faq/what-is-loopstake).

## carry and fees

the default theoretical position has $75k net source funding, $841,666.67 vDOT assets and $766,666.67 DOT debt. reserve rates respond to the additional positions. vDOT lending income responds to its increased supply. the fee applies to positive carry after DOT interest; Main HOLLAR interest is then paid from what remains. negative carry remains a depositor loss, with no performance fee. the annual accounting assumes interest servicing; actual harvest/repayment liquidity is outside the model.

the observed DOT → vDOT route wraps DOT into aDOT through Aave before swapping in pool 690. with 100% of borrowed DOT re-supplied by that route, reserve cash returns to its original level and total DOT supply increases alongside debt. the model therefore uses `(old debt + new debt) / (old cash + old debt + re-supply)` for utilization. the pool's aDOT is **not** a second position belonging to the strategy, and its lending income is not added to strategy carry. a control allows 0–100% re-supply to test alternate routes. interest rates and pool routing during a paced ramp remain uncertain.

| harvest fee | depositor carry APR | monthly compounded APY | annual protocol income / TVL |
| --- | --- | --- | --- |
| 69% | 4.858318% | 4.967973% | 18.679030% |
| 22% | 15.227243% | 16.336236% | 8.310105% |

at the default theoretical position the DOT borrowing rate rises to **1.924964%**. gross carry before the harvest fee and Main interest is **$22,061.54/year**. Main interest is **$1,980.76/year** at the pinned HOLLAR rate and 40% discount. protocol income comprises the harvest fee, Main HOLLAR interest and 10% of interest on the new DOT debt; the remaining DOT interest goes to reserve suppliers. repricing existing borrowers is excluded. the original HF 1.15 reference retains 1.445550% depositor APR at a 69% fee and 6.640278% at a 22% fee.

the UI also compares PRIME/HOLLAR using the same new market snapshot, TVL, Main LTV, Main discount and fee, with its existing HF 1.05, 6.2% historical PRIME growth assumption and 90% loop discount up to $5m debt. this is a comparison of theoretical targets, not a claim that they have equal risk or capacity. the older two-strategy view retains its own frozen 5 november snapshot and link semantics.

## entry and exit evidence

`src/data/vdot-quotes.json` records independent sdk-next **1.5.1** quotes at the same block. the large DOT entry quote is sized for the original HF 1.15 / 5× reference, not the new HF 1.01 target:

| trade | output | cost versus the oracle |
| --- | --- | --- |
| 1,000 HOLLAR → vDOT | 647.56056718 vDOT | 74.29 bps |
| 75,000 HOLLAR → vDOT | 40,669.86681823 vDOT | **1,688.24 bps (16.88%)** |
| 1,000 DOT → vDOT | 598.89521141 vDOT | 3.00 bps |
| 326,707.05716974 DOT → vDOT | 195,508.68763601 vDOT | 10.90 bps |
| 1,000 vDOT → DOT | 1,667.42693543 DOT | 10.86 bps |
| 100,000 vDOT → DOT | 166,674.26312687 DOT | 14.96 bps |
| 1,000 vDOT → HOLLAR | 1,522.89457921 HOLLAR | 64.53 bps |

fees are already included in output. cost versus oracle also includes market/oracle basis and price impact, so it need not equal the route fee. HOLLAR entry uses Omnipool → aDOT → pool 690; DOT entry uses Aave → aDOT → pool 690. exits reverse those mechanisms. SDK hop details are preserved in the evidence.

the 75k HOLLAR quote illustrates why the carry APR cannot be treated as a first-year return. it marks about $12.66k below the input, before any further loop swaps. the quotes are not sequential: each sees the original snapshot. they must not be summed into a claimed ramp or exit cost. a real capacity study needs paced tranches, price limits, reserve/pool mutation and refill. the economic model excludes these execution costs and shows the large seed-quote cost prominently.

## price risk

the lending oracle prices vDOT as **Bifrost's DOT-per-vDOT conversion rate × the same DOT/USD feed used for debt**. `src/data/vdot-oracle.json` verifies the deployed adapter code hash and exact product with zero residual on two RPCs, at the pinned block and finalized block 16709371. the rate comes from the ten-minute Bifrost feed `0x00000102626966726f73746f000000050000000f`; the shared DOT/USD source is `0xFBCa0A6dC5B74C042DF23025D99ef0F1fcAC6702`. the adapter is `0x2fFa376E0a84606e4Ccb3738071312A34Cebad6C`.

DOT/USD cancels from `HF = LT × vDOT units × conversion rate / DOT debt units`. ordinary DOT price moves and market trading discounts do not lower oracle HF. debt growth or a decline in the conversion-rate feed can still reduce it. a market discount affects execution value without changing this oracle feed.

the net strategy equity is still long DOT against HOLLAR Main debt. with an unchanged conversion rate, the instant oracle P&L is `initial equity × DOT/USD move`. a **30% DOT fall loses $22,500**, or **22.5% of the $100k deposit**, while loop HF remains **1.01**. source coverage falls to 70% of its initial HOLLAR funding.

the collapsed **Oracle stress** control (`vdotMove`) changes the conversion-rate feed itself. a 15% feed decline lowers HF to **0.8585**; this is not a market-discount scenario. these are instant marks before debt growth, keeper response, liquidation or harvest; negative equity is not clamped away.

the original vault collateral is held fixed in these shocks. its own price movement and Main liquidation risk are outside the comparison. the shock result is kept separate from annual carry, and positive unrealized price P&L is shown before harvesting fees.

## reproduce

```sh
npm run sim -- vdot --pretty
npm run sim -- vdot --fee 0.22 --set hf=1.15
npm run sim -- vdot --set dotMove=-0.3 --set vdotMove=0
npm run sim -- vdot --set useEMode=false --set hf=1.25
npm run sim -- vdot --params
node scripts/snapshot-vdot.mjs /tmp/vdot-market.json 16706517
node scripts/check-vdot-oracle.mjs /path/to/VDOT-USDOracleAdapter.json /tmp/vdot-oracle.json
HYDRATION_UI_ROOT=/path/to/hydration-ui node scripts/quote-vdot.mjs /tmp/vdot-market.json /tmp/vdot-quotes.json
SIM_URL=http://localhost:4173/ node scripts/smoke-vdot.mjs
```

the quote script uses the SDK installed in the supplied Hydration UI checkout. it retains the one-shot historical pool list while using the SDK's own fee queries and router math. it never constructs or sends a transaction.

new shares use `#t=vdot&vd=vd2.…` with complete assumptions; `sim link` decodes them and legacy engines reject them. old vd1 links preserve their settings and retain HF 1.15 when omitted. reset and new vd2 links use HF 1.01 with the same 69% fee. future snapshot changes require a new link version. the JSON export includes assumptions, results, market evidence, router quotes and oracle verification.
