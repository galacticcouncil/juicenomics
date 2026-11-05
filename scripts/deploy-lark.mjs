import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import { homedir } from 'node:os'

const target = process.env.DEPLOY_TARGET ?? 'production'
if (!['production', 'two-strategy'].includes(target)) throw new Error('unknown deployment target')
const preview = target === 'two-strategy'
const name = preview ? 'juicenomics-two-strategy' : 'juicenomics'
const site = `https://${name}.lark.hydration.cloud`
const tagSuffix = preview ? '-two-strategy' : ''
const image = process.env.DEPLOY_IMAGE
const revision = process.env.DEPLOY_REVISION
if (!/^[a-f0-9]{40}$/.test(revision ?? '') ||
    !new RegExp(`^galacticcouncil/juicenomics:${revision}${tagSuffix}@sha256:[a-f0-9]{64}$`).test(image ?? '')) {
  throw new Error('DEPLOY_IMAGE must match DEPLOY_REVISION and DEPLOY_TARGET')
}

const compose = (await readFile(new URL(`../docker/stack.${preview ? 'two-strategy' : 'lark'}.yml`, import.meta.url), 'utf8'))
  .replace(/^(    image: ).+$/m, `$1${image}`)
if (process.env.DEPLOY_DRY_RUN === '1') {
  console.log(JSON.stringify({ name, site, compose, revision, image }))
  process.exit(0)
}
const token = (process.env.SWARMPIT_TOKEN ?? await readFile(process.env.SWARMPIT_TOKEN_FILE ?? `${homedir()}/.lark_token`, 'utf8')).trim()
if (!token) throw new Error('empty Swarmpit token')
const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`, 'Content-Type': 'application/json' }
const base = 'https://swarmpit.lark.hydration.cloud/api/stacks'
const stacksResponse = await fetch(base, { headers, signal: AbortSignal.timeout(15_000) })
if (!stacksResponse.ok) throw new Error(`stack lookup failed: HTTP ${stacksResponse.status}`)
const stacks = await stacksResponse.json()
if (!Array.isArray(stacks)) throw new Error('unexpected stack list response')
const exists = stacks.some((s) => s.stackName === name)
if (!preview && !exists) throw new Error('production stack missing; refusing to create it')
const response = await fetch(exists ? `${base}/${name}` : base, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name, spec: { compose } }),
  signal: AbortSignal.timeout(120_000),
})
if (!response.ok) throw new Error(`stack deployment failed: HTTP ${response.status}`)

for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const [version, health] = await Promise.all([
      fetch(`${site}/version.txt?revision=${revision}`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`${site}/healthz`, { signal: AbortSignal.timeout(10_000) }),
    ])
    if (version.ok && (await version.text()).trim() === revision &&
        health.ok && (await health.text()).trim() === 'ok') {
      console.log(`deployed ${revision} to ${site}`)
      process.exit(0)
    }
  } catch {
    // the proxy can briefly lose its backend during rollout
  }
  await setTimeout(5_000)
}
throw new Error(`deployment did not become healthy at revision ${revision}`)
