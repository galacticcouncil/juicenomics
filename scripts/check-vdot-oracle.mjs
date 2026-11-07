import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http, keccak256, parseAbi } from 'viem'

const [artifactPath, output] = process.argv.slice(2)
if (!artifactPath || !output) throw Error('usage: node scripts/check-vdot-oracle.mjs <VDOT-USDOracleAdapter.json> <output.json>')
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
const market = JSON.parse(readFileSync(new URL('../src/data/vdot-market.json', import.meta.url), 'utf8'))
const rpcs = ['https://hdx.tarn.hydration.cloud', 'https://rpc.hydradx.cloud']
const clients = rpcs.map((rpc) => createPublicClient({ transport: http(rpc, { timeout: 30_000 }) }))
const finalized = await clients[0].request({ method: 'chain_getFinalizedHead' })
const header = await clients[0].request({ method: 'chain_getHeader', params: [finalized] })
const inspect = async (client, blockNumber) => {
  const read = (address, signature, args = []) => {
    const abi = parseAbi([signature])
    return client.readContract({ address, abi, functionName: abi[0].name, args, blockNumber })
  }
  assert.equal(await client.getChainId(), market.chainId)
  assert.equal(await client.request({ method: 'chain_getBlockHash', params: [0] }), market.genesis)
  const block = await client.getBlock({ blockNumber })
  const source = await read(market.oracle, 'function getSourceOfAsset(address) view returns (address)', [market.reserves.vDOT.address])
  const dotSource = await read(market.oracle, 'function getSourceOfAsset(address) view returns (address)', [market.reserves.DOT.address])
  assert.equal(source.toLowerCase(), artifact.address.toLowerCase())
  const ratioSource = await read(source, 'function assetToXOracle() view returns (address)')
  const usdSource = await read(source, 'function XToUsdOracle() view returns (address)')
  assert.equal(usdSource.toLowerCase(), dotSource.toLowerCase())
  assert.equal(ratioSource.toLowerCase(), artifact.args[0].toLowerCase())
  const [ratio, dotUsd, adapterUsd, aaveDotUsd, aaveVdotUsd, decimals, code, eMode] = await Promise.all([
    read(ratioSource, 'function latestAnswer() view returns (int256)'),
    read(dotSource, 'function latestAnswer() view returns (int256)'),
    read(source, 'function latestAnswer() view returns (int256)'),
    read(market.oracle, 'function getAssetPrice(address) view returns (uint256)', [market.reserves.DOT.address]),
    read(market.oracle, 'function getAssetPrice(address) view returns (uint256)', [market.reserves.vDOT.address]),
    read(source, 'function decimals() view returns (uint8)'),
    client.getCode({ address: source, blockNumber }),
    read(market.pool, 'function getEModeCategoryData(uint8) view returns ((uint16 ltv,uint16 liquidationThreshold,uint16 liquidationBonus,address priceSource,string label))', [2]),
  ])
  assert.equal(decimals, 8)
  assert(ratio > 0n && dotUsd > 0n)
  const product = ratio * dotUsd / 100_000_000n
  assert.equal(product, adapterUsd)
  assert.equal(adapterUsd, aaveVdotUsd)
  assert.equal(dotUsd, aaveDotUsd)
  assert.equal(eMode.priceSource, '0x0000000000000000000000000000000000000000')
  const codeHash = keccak256(code)
  assert.equal(codeHash, keccak256(artifact.deployedBytecode))
  const hash = await client.request({ method: 'chain_getBlockHash', params: [Number(blockNumber)] })
  return { block: blockNumber, hash, evmHash: block.hash, timestamp: block.timestamp, source, ratioSource, usdSource,
    ratio8: ratio, dotUsd8: dotUsd, vdotUsd8: adapterUsd, formulaResidual8: adapterUsd - product,
    sameDotUsdSource: true, codeMatchesArtifact: true, codeHash, eMode }
}
const blocks = [BigInt(market.block), BigInt(header.number)]
const samples = []
for (const block of blocks) {
  const [a, b] = await Promise.all(clients.map((c) => inspect(c, block)))
  assert.deepEqual(a, b)
  samples.push(a)
}
assert.equal(samples[0].hash, market.hash)
assert.equal(String(samples[0].vdotUsd8), market.reserves.vDOT.priceUSD8)
assert.equal(String(samples[0].dotUsd8), market.reserves.DOT.priceUSD8)
const result = { observedAt: new Date().toISOString(), rpcs, crossRpcMatches: true,
  formula: 'vDOT/USD = floor(Bifrost DOT-per-vDOT ten-minute EMA × shared DOT/USD / 1e8)',
  ratioKind: 'Bifrost conversion-rate feed; not the vDOT/DOT market trading price',
  pinned: samples[0], current: samples[1] }
writeFileSync(output, JSON.stringify(result, (_, x) => typeof x === 'bigint' ? String(x) : x, 2) + '\n')
console.log(JSON.stringify(result, (_, x) => typeof x === 'bigint' ? String(x) : x, 2))
