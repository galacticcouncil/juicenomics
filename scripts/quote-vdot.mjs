import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [snapshotPath, output, funding = 'HOLLAR'] = process.argv.slice(2)
const root = process.env.HYDRATION_UI_ROOT
if (!root || !snapshotPath || !output || !['HOLLAR', 'DOT'].includes(funding)) throw Error('usage: HYDRATION_UI_ROOT=/path/to/hydration-ui node scripts/quote-vdot.mjs <snapshot.json> <output.json> [HOLLAR|DOT]')
const require = createRequire(resolve(root, 'package.json'))
const { api, createSdkContext } = require('@galacticcouncil/sdk-next')
const { TradeRouter } = require('@galacticcouncil/sdk-next/sor')
const { createClient } = require('polkadot-api')
const sdkVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/@galacticcouncil/sdk-next/package.json'), 'utf8')).version
const market = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const client = createClient(api.getWs(market.ws))
let sdk
try {
  sdk = await createSdkContext(client, { at: market.hash })
  const pools = await sdk.ctx.pool.getPools()
  const router = new TradeRouter({ getPools: async () => pools, getPoolFees: (pair, pool) => sdk.ctx.pool.getPoolFees(pair, pool) })
  const quotes = []
  const debtDot = 300_000 / (Number(market.reserves.DOT.priceUSD8) / 1e8)
  const mainDot = 75_000 / (Number(market.reserves.DOT.priceUSD8) / 1e8)
  const loopDot = (75_000 * 1.01 / (1.01 - 0.92) - 75_000) / (Number(market.reserves.DOT.priceUSD8) / 1e8)
  const trades = funding === 'DOT'
    ? [[5, 15, '1000', 'small entry'], [5, 15, mainDot.toFixed(10), 'funding'], [5, 15, loopDot.toFixed(10), 'loop'], [15, 5, '1000', 'small exit'], [15, 5, '100000', 'large exit']]
    : [[222, 15, '1000'], [222, 15, '75000'], [5, 15, '1000'], [5, 15, String(debtDot.toFixed(10))], [15, 5, '1000'], [15, 5, '100000'], [15, 222, '1000']]
  for (const [assetIn, assetOut, amountIn, role] of trades) {
    const trade = await router.getBestSell(assetIn, assetOut, amountIn)
    const quote = trade.toHuman()
    if (quote.swaps.some((swap) => swap.errors?.length)) throw Error('router reported an invalid trade')
    const name = id => ({ 5: 'DOT', 15: 'vDOT', 222: 'HOLLAR' })[id]
    const inputPrice = Number(market.reserves[name(assetIn)].priceUSD8) / 1e8
    const outputPrice = Number(market.reserves[name(assetOut)].priceUSD8) / 1e8
    quotes.push({ assetIn, assetOut, amountIn, role, quote,
      costVsOracleBps: (1 - Number(quote.amountOut) * outputPrice / (Number(amountIn) * inputPrice)) * 1e4 })
  }
  writeFileSync(output, JSON.stringify({ block: market.block, hash: market.hash, sdkVersion, funding,
    scope: 'independent one-shot quotes at a pinned block; no shared pool mutation between quotes; not a ramp or executable guarantee', quotes }, null, 2) + '\n')
  console.log(JSON.stringify({ block: market.block, output, quotes: quotes.map((q) => ({ assetIn: q.assetIn, assetOut: q.assetOut, amountIn: q.amountIn, amountOut: q.quote.amountOut, costVsOracleBps: q.costVsOracleBps })) }))
} finally {
  sdk?.destroy()
  client.destroy()
}
