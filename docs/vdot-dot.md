# vDOT / DOT alternative

this preview replaces the PRIME/HOLLAR source with a vDOT-collateral / DOT-debt loop for marginal new funding. Main still borrows HOLLAR against the original vault collateral. the comparison starts with $100k new collateral, 75% Main LTV, DOT eMode, HF 1.15 and the existing 69% harvest fee. it models economics only: no strategy contract, keeper integration, governance change or active reallocation is included.

the flow is HOLLAR → vDOT, supply vDOT, borrow DOT, swap to more vDOT and supply again. an eventual unwind would repay DOT and return HOLLAR to the source. this would require its own Aave account, a vDOT-capable harvester, truthful USD backing and explicit treatment of DOT equity exposure; the preview does not claim that those contract paths exist.

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

the minimum borrowable HF in eMode is `0.92 / 0.85 = 1.08235294`, even though liquidation starts at HF 1. a target of 1.05 would violate the borrowing LTV. the default HF 1.15 gives 5× leverage and an 80% loop LTV. standard mode uses its own thresholds and minimum HF, `0.70 / 0.60`.

the staking assumption comes from the on-chain Bifrost DOT-per-vDOT feed, not vDOT/USD. between blocks 15525295 and 16706517, exactly 30 days elapsed and the exchange rate increased from **1.66325910** to **1.66923945 DOT/vDOT**. the 0.359556% window return annualizes linearly to **4.374600% APR**. this is backward-looking native growth, already reflected in the exchange rate; staking fees are not deducted again. no incentive rewards are added. [Bifrost explains the exchange-rate mechanism](https://docs.bifrost.io/faq/what-are-vtokens/vdot) and [leveraged staking](https://docs.bifrost.io/faq/what-is-loopstake).

## carry and fees

the default position has $75k net source funding, $375k vDOT assets and $300k DOT debt. reserve rates respond to the additional positions. vDOT lending income responds to its increased supply. the fee applies to positive carry after DOT interest; Main HOLLAR interest is then paid from what remains. negative carry remains a depositor loss, with no performance fee. the annual accounting assumes interest servicing; actual harvest/repayment liquidity is outside the model.

the observed DOT → vDOT route wraps DOT into aDOT through Aave before swapping in pool 690. with 100% of borrowed DOT re-supplied by that route, reserve cash returns to its original level and total DOT supply increases alongside debt. the model therefore uses `(old debt + new debt) / (old cash + old debt + re-supply)` for utilization. the pool's aDOT is **not** a second position belonging to the strategy, and its lending income is not added to strategy carry. a control allows 0–100% re-supply to test alternate routes. interest rates and pool routing during a paced ramp remain uncertain.

| harvest fee | depositor carry APR | monthly compounded APY | annual protocol income / TVL |
| --- | --- | --- | --- |
| 69% | 1.445550% | 1.455166% | 10.142280% |
| 22% | 6.640278% | 6.846147% | 4.947552% |

at the default position the DOT borrowing rate rises to **1.784058%**. gross carry before the harvest fee and Main interest is **$11,052.61/year**. Main interest is **$1,980.76/year** at the pinned HOLLAR rate and 40% discount. protocol income comprises the harvest fee, Main HOLLAR interest and 10% of interest on the new DOT debt; the remaining DOT interest goes to reserve suppliers. repricing existing borrowers is excluded.

the UI also compares PRIME/HOLLAR using the same new market snapshot, TVL, Main LTV, Main discount and fee, with its existing HF 1.05, 6.2% historical PRIME growth assumption and 90% loop discount up to $5m debt. this is a comparison of theoretical targets, not a claim that they have equal risk or capacity. the older two-strategy view retains its own frozen 5 november snapshot and link semantics.

## entry and exit evidence

`src/data/vdot-quotes.json` records independent sdk-next **1.5.1** quotes at the same block:

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

vDOT and DOT move together against USD, but the net strategy equity is still long DOT against HOLLAR Main debt. with no relative vDOT discount, the instant source P&L is `initial equity × DOT/USD move`. a **30% DOT fall loses $22,500**, or **22.5% of the $100k deposit**, while loop HF remains **1.15**. source coverage falls to 70% of its initial HOLLAR funding.

a separate relative vDOT/DOT move hits gross collateral. at a 15% oracle-recognized vDOT discount and flat DOT/USD, HF becomes **0.9775** and the loop is liquidatable. these are marks before interest, keeper response, liquidation or harvest; negative equity is not clamped away. a market-only discount may impair exits before the oracle recognizes it.

the original vault collateral is held fixed in these shocks. its own price movement and Main liquidation risk are outside the comparison. the shock result is kept separate from annual carry, and positive unrealized price P&L is shown before harvesting fees.

## reproduce

```sh
npm run sim -- vdot --pretty
npm run sim -- vdot --fee 0.22 --set hf=1.15
npm run sim -- vdot --set dotMove=-0.3 --set vdotMove=0
npm run sim -- vdot --set useEMode=false --set hf=1.25
npm run sim -- vdot --params
node scripts/snapshot-vdot.mjs /tmp/vdot-market.json 16706517
HYDRATION_UI_ROOT=/path/to/hydration-ui node scripts/quote-vdot.mjs /tmp/vdot-market.json /tmp/vdot-quotes.json
SIM_URL=http://localhost:4173/ node scripts/smoke-vdot.mjs
```

the quote script uses the SDK installed in the supplied Hydration UI checkout. it retains the one-shot historical pool list while using the SDK's own fee queries and router math. it never constructs or sends a transaction.

shares use `#t=vdot&vd=vd1.…` with complete assumptions; `sim link` decodes them and legacy engines reject them. future snapshot changes require a new link version. the JSON export includes assumptions, results, market evidence and router quotes.
