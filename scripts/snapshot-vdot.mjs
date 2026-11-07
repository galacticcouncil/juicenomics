import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { blake2AsU8a } from '@polkadot/util-crypto'
import { createPublicClient, http, parseAbi } from 'viem'

const [output, blockText] = process.argv.slice(2)
if (!output) throw Error('usage: node scripts/snapshot-vdot.mjs <output.json> [block]')
const rpc = 'https://hdx.tarn.hydration.cloud'
const ws = 'wss://hdx.tarn.hydration.cloud'
const api = await ApiPromise.create({ provider: new WsProvider(ws), noInitWarn: true })
try {
  const finalizedHash = await api.rpc.chain.getFinalizedHead()
  const finalized = (await api.rpc.chain.getHeader(finalizedHash)).number.toBigInt()
  const block = blockText ? BigInt(blockText) : finalized
  assert(block <= finalized, 'requested block must be finalized')
  const hash = (await api.rpc.chain.getBlockHash(block)).toHex()
  const at = await api.at(hash)
  const client = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) })
  const read = (address, signature, args = [], blockNumber = block) => {
    const abi = parseAbi([signature])
    return client.readContract({ address, abi, functionName: abi[0].name, args, blockNumber })
  }
  const token = id => `0x${(0x100000000n + BigInt(id)).toString(16).padStart(40, '0')}`
  const pool = '0x1b02E051683b5cfaC5929C25E84adb26ECf87B38'
  const provider = await read(pool, 'function ADDRESSES_PROVIDER() view returns (address)')
  const oracle = await read(provider, 'function getPriceOracle() view returns (address)')
  const timestamp = (await at.query.timestamp.now()).toBigInt() / 1000n
  const genesis = api.genesisHash.toHex()
  const chainId = await client.getChainId()
  assert.equal(genesis, '0xafdc188f45c71dacbaa0b62e16a91f726c7b8699a9748cdf715459de6b7f366d')
  assert.equal(chainId, 222222)
  const out = { observedAt: new Date().toISOString(), rpc, ws, block, hash, genesis, chainId,
    timestamp, runtime: at.runtimeVersion.specVersion.toNumber(), pool, oracle, assets: {}, reserves: {}, curves: {} }
  const reserveAbi = 'function getReserveData(address) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 liquidityRate,uint128 borrowIndex,uint128 borrowRate,uint128 stableRate,uint40 updatedAt,uint16 id,address aToken,address stableDebt,address variableDebt,address strategy,uint128 accrued,uint128 unbacked,uint128 isolationDebt))'
  for (const [name, id] of [['vDOT', 15], ['DOT', 5], ['PRIME', 43], ['HOLLAR', 222]]) {
    const a = (await at.query.assetRegistry.assets(id)).unwrap()
    out.assets[id] = { symbol: a.symbol.toHuman(), decimals: Number(a.decimals.toString()), type: a.assetType.toString() }
    const address = id === 222 ? '0x531a654d1696ED52e7275A8cede955E82620f99a' : token(id)
    const r = await read(pool, reserveAbi, [address])
    const bits = (start, length) => (r.configuration >> BigInt(start)) & ((1n << BigInt(length)) - 1n)
    const source = await read(oracle, 'function getSourceOfAsset(address) view returns (address)', [address])
    let round = { available: false }
    try {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = await read(source, 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)')
      round = { available: true, roundId, answer, startedAt, updatedAt, answeredInRound, ageSeconds: timestamp - updatedAt }
    } catch {}
    const [priceUSD8, decimals, supply, variableDebt, stableDebt, availableLiquidity] = await Promise.all([
      read(oracle, 'function getAssetPrice(address) view returns (uint256)', [address]),
      read(address, 'function decimals() view returns (uint8)'),
      read(r.aToken, 'function totalSupply() view returns (uint256)'),
      read(r.variableDebt, 'function totalSupply() view returns (uint256)'),
      read(r.stableDebt, 'function totalSupply() view returns (uint256)'),
      read(address, 'function balanceOf(address) view returns (uint256)', [r.aToken]),
    ])
    assert.equal(decimals, out.assets[id].decimals)
    out.reserves[name] = { address, aToken: r.aToken, variableDebtToken: r.variableDebt, stableDebtToken: r.stableDebt,
      configuration: r.configuration, priceUSD8, decimals, ltvBps: bits(0, 16), ltBps: bits(16, 16),
      active: bits(56, 1), frozen: bits(57, 1), borrowing: bits(58, 1), paused: bits(60, 1),
      eMode: bits(168, 8), reserveFactorBps: bits(64, 16), borrowCap: bits(80, 36), supplyCap: bits(116, 36),
      isolationCeilingUSD2: bits(212, 40), isolationDebtUSD2: r.isolationDebt,
      liquidityRateRay: r.liquidityRate, borrowRateRay: r.borrowRate, rateStrategy: r.strategy,
      supply, variableDebt, stableDebt, availableLiquidity, oracleSource: source, round }
    if (name !== 'HOLLAR') {
      out.curves[name] = {}
      for (const [key, method] of [['optimal', 'OPTIMAL_USAGE_RATIO'], ['base', 'getBaseVariableBorrowRate'], ['slope1', 'getVariableRateSlope1'], ['slope2', 'getVariableRateSlope2']]) {
        out.curves[name][key] = await read(r.strategy, `function ${method}() view returns (uint256)`)
      }
    }
  }
  out.eMode = await read(pool, 'function getEModeCategoryData(uint8) view returns ((uint16 ltv,uint16 liquidationThreshold,uint16 liquidationBonus,address priceSource,string label))', [Number(out.reserves.vDOT.eMode)])
  const rateOracle = '0x00000100626966726f73746f000000050000000f'
  const latestRate = await read(rateOracle, 'function latestAnswer() view returns (int256)')
  const target = timestamp - 30n * 86400n
  let low = block - 1_500_000n, high = block
  assert((await client.getBlock({ blockNumber: low })).timestamp < target)
  while (high - low > 1n) {
    const mid = (low + high) / 2n
    if ((await client.getBlock({ blockNumber: mid })).timestamp <= target) low = mid
    else high = mid
  }
  const pastTimestamp = (await client.getBlock({ blockNumber: low })).timestamp
  const pastRate = await read(rateOracle, 'function latestAnswer() view returns (int256)', [], low)
  assert(latestRate > 0n && pastRate > 0n)
  const elapsed = Number(timestamp - pastTimestamp)
  const growth = Number(latestRate) / Number(pastRate) - 1
  const entry = (await at.query.emaOracle.oracles('0x626966726f73746f', [5, 15], 'LastBlock')).toJSON()
  if (!entry?.[0]?.updatedAt) throw Error('missing Bifrost rate update block')
  const feedTimestamp = (await client.getBlock({ blockNumber: BigInt(entry[0].updatedAt) })).timestamp
  out.vdotGrowth = { oracle: rateOracle, latestRate, pastRate, pastBlock: low, pastTimestamp,
    elapsedSeconds: elapsed, windowReturn: growth, simpleAnnualizedApr: growth * 365 * 86400 / elapsed,
    method: 'annualized growth in the on-chain Bifrost DOT-per-vDOT rate, excluding DOT/USD; backward-looking assumption',
    feedEntry: entry, feedTimestamp, feedAgeSeconds: timestamp - feedTimestamp }
  const poolId = 690
  const encoded = Buffer.alloc(4)
  encoded.writeUInt32LE(poolId)
  const account = `0x${Buffer.from(blake2AsU8a(Buffer.concat([Buffer.from('sts'), encoded]), 256)).toString('hex')}`
  out.pool690 = { config: (await at.query.stableswap.pools(poolId)).toJSON(), account,
    balances: {}, pegs: (await at.query.stableswap.poolPegs(poolId)).toJSON() }
  for (const id of [15, 1001]) out.pool690.balances[id] = (await at.call.currenciesApi.account(id, account)).free.toString()
  const other = createPublicClient({ transport: http('https://rpc.hydradx.cloud', { timeout: 30_000 }) })
  const crossHash = await other.request({ method: 'chain_getBlockHash', params: [Number(block)] })
  assert.equal(crossHash, hash)
  const crossReserves = {}
  for (const [name, r] of Object.entries(out.reserves)) {
    const abi = parseAbi(['function totalSupply() view returns (uint256)'])
    const supply = await other.readContract({ address: r.aToken, abi, functionName: 'totalSupply', blockNumber: block })
    const debt = await other.readContract({ address: r.variableDebtToken, abi, functionName: 'totalSupply', blockNumber: block })
    assert.equal(supply, r.supply)
    assert.equal(debt, r.variableDebt)
    crossReserves[name] = { supplyResidual: supply - r.supply, debtResidual: debt - r.variableDebt }
  }
  out.crosscheck = { rpc: 'https://rpc.hydradx.cloud', hash: crossHash, reserves: crossReserves, matches: true }
  writeFileSync(output, JSON.stringify(out, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n')
  console.log(JSON.stringify({ block: String(block), hash, growthApr: out.vdotGrowth.simpleAnnualizedApr, eMode: out.eMode, output }))
} finally {
  await api.disconnect()
}
