import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http, parseAbi } from 'viem'

const output = process.argv[2]
if (!output) throw Error('usage: node scripts/check-vdot-funding.mjs <output.json>')
const market = JSON.parse(readFileSync(new URL('../src/data/vdot-market.json', import.meta.url), 'utf8'))
const bindings = JSON.parse(readFileSync(new URL('../docs/evidence/vdot-compatibility.json', import.meta.url), 'utf8'))
const address = bindings.getters.vault.collateral
const rpcs = ['https://hdx.tarn.hydration.cloud', 'https://rpc.hydradx.cloud']
const samples = await Promise.all(rpcs.map(async rpc => {
  const client = createPublicClient({ transport: http(rpc, { timeout: 20_000 }) })
  assert.equal(await client.getChainId(), market.chainId)
  assert.equal(await client.request({ method: 'chain_getBlockHash', params: [0] }), market.genesis)
  assert.equal(await client.request({ method: 'chain_getBlockHash', params: [Number(market.block)] }), market.hash)
  const config = await client.readContract({ address: market.pool,
    abi: parseAbi(['function getConfiguration(address) view returns ((uint256 data))']),
    functionName: 'getConfiguration', args: [address], blockNumber: BigInt(market.block) })
  const bits = (start, length) => Number(config.data >> BigInt(start) & ((1n << BigInt(length)) - 1n))
  return { address, configuration: String(config.data), ltvBps: bits(0, 16), ltBps: bits(16, 16),
    eMode: bits(168, 8), active: bits(56, 1), frozen: bits(57, 1), paused: bits(60, 1), isolationCeilingUSD2: bits(212, 40) }
}))
assert.deepEqual(samples[0], samples[1])
const result = { block: market.block, hash: market.hash, rpcs, crossRpcMatches: true,
  collateral: 'GIGAETH', mainEMode: 0, sourceEMode: 2, reserve: samples[0],
  scope: 'GIGAETH standard-mode reference for a new DOT-funded Main account; existing deployed Main remains HOLLAR-bound' }
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
