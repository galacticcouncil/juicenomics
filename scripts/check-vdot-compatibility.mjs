import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http, keccak256, parseAbi } from 'viem'

const [manifestPath, output] = process.argv.slice(2)
if (!manifestPath || !output) throw Error('usage: node scripts/check-vdot-compatibility.mjs <launch-manifest.json> <output.json>')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const rpc = 'https://hdx.tarn.hydration.cloud'
const crossRpc = 'https://rpc.hydradx.cloud'
const primary = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) })
const secondary = createPublicClient({ transport: http(crossRpc, { timeout: 30_000 }) })
const hash = await primary.request({ method: 'chain_getFinalizedHead' })
const header = await primary.request({ method: 'chain_getHeader', params: [hash] })
const block = BigInt(header.number)
const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const vault = manifest.vaults.find((v) => v.key === 'ETH')
const addresses = { source: manifest.addresses.subLoop, vault: vault.address,
  ledger: vault.mainDebt, harvester: manifest.addresses.harvester }
const methods = { source: ['hollar', 'prime', 'primeAToken', 'logic', 'harvester'],
  vault: ['hollar', 'hollarDebtToken', 'yieldSource', 'mainDebt', 'collateral', 'compoundLogic'],
  ledger: ['hollar', 'debtToken', 'vault'], harvester: ['prime', 'subLoop'] }
const inspect = async (client) => {
  assert.equal(await client.getChainId(), manifest.chainId)
  assert.equal(await client.request({ method: 'chain_getBlockHash', params: [0] }), manifest.genesis)
  assert.equal(await client.request({ method: 'chain_getBlockHash', params: [Number(block)] }), hash)
  const result = { getters: {}, implementations: {}, runtimeHashes: {} }
  for (const [label, address] of Object.entries(addresses)) {
    result.getters[label] = Object.fromEntries(await Promise.all(methods[label].map(async (method) => [method,
      (await client.readContract({ address, abi: parseAbi([`function ${method}() view returns (address)`]), functionName: method, blockNumber: block })).toLowerCase(),
    ])))
  }
  for (const label of ['source', 'vault']) {
    const value = await client.getStorageAt({ address: addresses[label], slot, blockNumber: block })
    result.implementations[label] = `0x${value.slice(-40)}`.toLowerCase()
  }
  assert.equal(result.implementations.source, manifest.addresses.subImpl.toLowerCase())
  assert.equal(result.implementations.vault, manifest.addresses.vaultImpl.toLowerCase())
  for (const label of ['SubLoop', 'SubLoopLogic', 'CollateralVault', 'CompoundLogic', 'MainDebt.ETH', 'Harvester']) {
    const deployed = manifest.deployments.find((d) => d.label === label)
    const code = await client.getCode({ address: deployed.address, blockNumber: block })
    assert(code && code !== '0x')
    const codeHash = keccak256(code)
    assert.equal(codeHash, deployed.codeHash)
    result.runtimeHashes[label] = codeHash
  }
  for (const label of ['source', 'vault', 'ledger']) assert.equal(result.getters[label].hollar, manifest.market.hollar.toLowerCase())
  assert.equal(result.getters.vault.yieldSource, addresses.source.toLowerCase())
  assert.equal(result.getters.vault.mainDebt, addresses.ledger.toLowerCase())
  assert.equal(result.getters.ledger.debtToken, manifest.market.hollarDebt.toLowerCase())
  assert.equal(result.getters.source.prime, manifest.market.prime.toLowerCase())
  assert.equal(result.getters.harvester.prime, manifest.market.prime.toLowerCase())
  return result
}
const [a, b] = await Promise.all([inspect(primary), inspect(secondary)])
assert.deepEqual(a, b)
const timestamp = (await primary.getBlock({ blockNumber: block })).timestamp
const evidence = { block: String(block), hash, timestamp: String(timestamp), rpc, crossRpc,
  chainId: manifest.chainId, genesis: manifest.genesis, addresses, ...a, crossRpcMatches: true,
  conclusion: 'live Main is bound to HOLLAR; the source and harvester remain PRIME-specific. a vDOT/DOT source requires new contracts behind a compatible HOLLAR settlement interface. changing Main to DOT cannot be achieved by configuring the deployed ledger.' }
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({ block: String(block), crossRpcMatches: true, getters: a.getters, implementations: a.implementations, output }, null, 2))
