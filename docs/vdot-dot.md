# vDOT / DOT with direct DOT funding

this preview models **original vault collateral → borrow DOT → buy vDOT → supply vDOT → borrow more DOT**. both loans owe DOT. HOLLAR is absent from this funding path; it remains in the separate PRIME benchmark and historical shared scenarios.

the requested defaults are $100k of original collateral, 75% vault borrowing LTV, 69% harvest fee and loop HF 1.01. the loop target exceeds current borrowing LTV, so its carry is theoretical and the violation remains visible. the scope is economics for new funding: no strategy contracts, keepers, governance changes or active reallocation are implemented.

[dedicated preview](https://juicenomics-vdot.lark.hydration.cloud/#t=vdot). `scripts/publish-lark.sh vdot` targets its separate stack, router and image tag.

## funding and contract compatibility

| borrowing account | collateral | debt |
| --- | --- | --- |
| vault / Main | original vault asset; GIGAETH is the pinned reference | DOT |
| separate source loop | vDOT | DOT |

the initial DOT loan buys the first vDOT position. the source supplies that vDOT and borrows more DOT to buy additional vDOT. unwinding must repay loop DOT debt and return DOT to settle the original vault loan. neither account supplies HOLLAR as collateral.

the deployed contracts do not support this through configuration. `JuicerMainDebt.hollar` and `debtToken` are immutable; the vault also binds HOLLAR and uses USD8-to-HOLLAR18 conversions. `CollateralVault.setMainDebt` rejects replacing an attached ledger. DOT has 10 decimals and a floating USD price. the existing source and harvester are PRIME-specific.

this design needs a DOT-denominated Main ledger, reviewed vault borrowing/repayment and fee settlement, a vDOT/DOT source, harvesting and keeper support, plus a deployment or explicit migration design. the preview provides none of those implementations. [binding and runtime evidence](evidence/vdot-compatibility.json) compares six deployed contracts with the launch manifest on two RPCs at #16708292.

## pinned evidence and limits

`src/data/vdot-market.json` pins mainnet **#16706517**, **6 november 2026, 23:11 UTC**, hash `0x95fc79bfdb3d780b1839ece009bd62cb9e89d12d11f2afe99de715f9a3334683`. supplies and debts agree on two RPCs with zero residuals. `src/data/vdot-funding.json` adds the original GIGAETH collateral configuration at the same block.

| input | reference |
| --- | --- |
| original collateral | GIGAETH, standard mode: 80% borrowing LTV / 85% liquidation threshold |
| source collateral | vDOT, DOT eMode: 85% borrowing LTV / 92% liquidation threshold |
| account modes | vault standard mode; separate source DOT eMode |
| DOT / vDOT | assets 5 / 15; both 10 decimals |
| pinned prices | DOT $0.91825381; vDOT $1.53278548 |
| DOT rate curve | 0 base; 2.75% at 85% utilization; 49.5% at full utilization |
| DOT reserve factor | 10% of interest, on both new DOT loans |
| native vDOT growth | 4.374600% APR, annualized 30-day DOT-per-vDOT feed growth |

the vault uses an editable collateral liquidation threshold, initially 85%. its 75% funding LTV fits the reference 80% borrow limit. other original collateral requires checking its own limits.

the loop's minimum borrowable HF is `0.92 / 0.85 = 1.08235294`. requested HF 1.01 gives 11.2222× source leverage and 91.0891% loop LTV, exceeding 85%. the $841,666.67 source exposure also exceeds the unchanged $500k candidate cap. targets are flagged rather than clipped.

## interest, fees and carry

at the default target:

- initial vault loan: $75,000, or 81,676.764292 DOT;
- loop loan: $766,666.67, or 834,918.034989 DOT;
- total new DOT debt: 916,594.799282 DOT;
- vDOT collateral: $841,666.67 at the oracle.

**both** loans enter DOT reserve debt and utilization. the observed DOT → aDOT → vDOT route re-supplies DOT through Aave, so the default 100% re-supply assumption also adds both borrowed amounts to reserve supply and restores reserve cash. the pool's aDOT is not a second strategy position; its lending yield is not credited to the strategy.

DOT borrow APR uses the reserve curve by default: **1.945097%** after both loans at this target. uncheck **Use DOT reserve curve** to enter a fixed APR, including 0%. the selected rate applies to both loans without discounts. reserve/capacity checks continue to use the modeled positions. exports include the applied rate and the reserve-curve comparison.

the fee convention remains: positive source carry after loop interest pays the harvest fee; interest on the initial vault loan is paid from the remainder. negative source carry pays no performance fee. at a 69% fee, loop interest is **$14,912.41/year**, source carry before fee **$21,907.19/year**, and initial vault interest **$1,458.82/year**.

| harvest fee | theoretical depositor carry APR | monthly compounded APY | annual protocol income / TVL |
| --- | --- | --- | --- |
| 69% | 5.332406% | 5.464681% | 16.753085% |
| 22% | 15.628786% | 16.798363% | 6.456705% |

protocol income is the harvest fee plus the **10% reserve-factor share of interest on both DOT loans**. the other 90% goes to DOT reserve suppliers. the model does not count all initial vault interest as protocol revenue. depositor income, protocol income and supplier interest reconcile to vDOT income; the default was independently checked using 50-digit decimal arithmetic.

these annual figures assume flat DOT/USD and interest servicing. they exclude execution costs, ramp delays, gas, incentives and compounding constraints. native growth is backward-looking DOT-per-vDOT growth, not vDOT/USD appreciation. staking fees are already reflected in that conversion rate.

the PRIME comparison keeps its own HOLLAR funding, 40% Main interest discount, HF 1.05, 6.2% historical native growth and 90% loop interest discount on up to $5m debt. it shares the chosen TVL, initial funding LTV and harvest fee; the two designs have different debt currencies and risks.

## oracle and price shocks

`src/data/vdot-oracle.json` verifies the deployed vDOT adapter, its runtime hash and exact product on two RPCs at #16706517 and #16709371: **Bifrost's ten-minute DOT-per-vDOT conversion rate × the same DOT/USD feed used for debt**. a market trading discount does not change that oracle feed.

with an unchanged conversion rate, DOT/USD cancels from the source loop's HF. including the original DOT funding loan, the strategy principal is also matched in DOT: a common DOT price move produces **zero source surplus/shortfall versus its DOT funding obligation** before interest, execution and fees.

the original vault is a separate borrowing position. its collateral is held fixed in USD in these instant shocks. at 75% funding LTV and 85% collateral LT, initial vault HF is **1.1333**. a 50% DOT rise increases its debt value and lowers vault HF to **0.7556**, while loop HF stays **1.01**. repayment or rebalancing is not simulated. matched aggregate principal does not prevent liquidation of an individual borrowing account.

the **Oracle stress** control changes the conversion-rate feed itself. a 15% feed decline lowers loop HF from 1.01 to 0.8585 and reduces source backing. debt growth can also lower HF over time; the price-shock panel is an instant mark, not a time simulation. unrealized source surplus is shown before harvesting fees.

## routing evidence

`src/data/vdot-dot-quotes.json` contains independent sdk-next **1.5.1** quotes at the pinned block:

| trade | output | cost versus oracle |
| --- | --- | --- |
| 1,000 DOT → vDOT | 598.8952114147 vDOT | 3.00 bps |
| 81,676.7642924346 DOT → vDOT, initial funding | 48,906.3001285249 vDOT | 4.95 bps |
| 834,918.0349893316 DOT → vDOT, loop reference | 498,873.3622086743 vDOT | 26.10 bps |
| 1,000 vDOT → DOT | 1,667.4269354262 DOT | 10.86 bps |
| 100,000 vDOT → DOT | 166,674.2631268709 DOT | 14.96 bps |

fees are included in quoted output; cost versus oracle includes basis and price impact. each quote sees the original pool state, so these cannot be summed into a full-ramp cost. a paced-ramp study needs sequential reserve/pool changes and refill. the old HOLLAR quotes remain available only for historical scenarios.

## reproduce and share

```sh
npm run sim -- vdot --pretty
npm run sim -- vdot --set dotBorrowApr=0.03
npm run sim -- vdot --set dotBorrowApr=null
npm run sim -- vdot --set dotMove=0.5
npm run sim -- vdot --set useEMode=false --set hf=1.25
npm run sim -- vdot --params
node scripts/check-vdot-funding.mjs /tmp/vdot-funding.json
node scripts/check-vdot-oracle.mjs /path/to/VDOT-USDOracleAdapter.json /tmp/vdot-oracle.json
HYDRATION_UI_ROOT=/path/to/hydration-ui node scripts/quote-vdot.mjs src/data/vdot-market.json /tmp/vdot-dot-quotes.json DOT
SIM_URL=http://localhost:4173/ EXPECT_DEFAULT_TAB=vdot node scripts/smoke-vdot.mjs
```

new shares use `#t=vdot&vd=vd4.…`, including `fundingAsset: DOT` and the optional manual rate. vd1–vd3 links retain HOLLAR funding and their original fee/discount/HF settings; vd1's omitted HF remains 1.15, vd2/vd3's 1.01. the old 69% / HF 1.01 scenario retains 4.858318% carry APR. reset switches to direct DOT funding, 69% fee, HF 1.01 and automatic DOT pricing. legacy simulation engines reject vDOT links. JSON exports include the complete scenario, results, market, collateral, oracle and routing evidence.
