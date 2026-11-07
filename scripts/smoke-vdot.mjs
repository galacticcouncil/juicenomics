import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const origin = process.env.SIM_URL ?? 'http://localhost:4173/'
const out = new URL('../screens/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER ?? '/usr/bin/brave' })
const errors = []
const check = (ok, message) => { assert.ok(ok, message); console.log(`ok   ${message}`) }
const open = async (url, width = 1440, colorScheme = 'light') => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.vdot-view')
  return page
}
try {
  if (process.env.EXPECT_DEFAULT_TAB === 'vdot') {
    const root = await open(origin)
    check(await root.getByTestId('vdot-apr').innerText() === '4.86%', 'the separate subdomain opens the vDOT preview by default')
    await root.close()
  }
  const page = await open(`${origin}#t=vdot`)
  check(await page.getByTestId('vdot-apr').innerText() === '4.86%', 'default theoretical carry matches the model')
  check(await page.getByLabel('Loop target HF', { exact: true }).inputValue() === '1.01' && await page.getByRole('button', { name: '69% fee', exact: true }).getAttribute('aria-pressed') === 'true', 'default HF is 1.01 and the fee is 69%')
  check((await page.getByTestId('vdot-status').innerText()).includes('91.09%') && (await page.getByTestId('vdot-status').innerText()).includes('1.0824'), 'the default target shows the borrowing LTV constraint')
  check((await page.getByTestId('vdot-status').innerText()).includes('16.88%'), 'large HOLLAR entry cost is visible beside the headline')
  check(await page.getByTestId('vdot-shock-pnl').innerText() === '−22.50%', '30% DOT fall exposes the HOLLAR funding shortfall')
  check(await page.getByTestId('vdot-shock-hf').innerText() === '1.010×', 'common DOT fall leaves loop HF unchanged')
  check((await page.locator('.vdot-risk').innerText()).includes('market trading discounts leave oracle HF unchanged'), 'oracle HF is distinguished from market execution prices')
  await page.getByRole('button', { name: '22% fee', exact: true }).click()
  check(await page.getByTestId('vdot-apr').innerText() === '15.23%', 'fee comparison updates carry')
  await page.locator('summary').filter({ hasText: /^Oracle stress$/ }).click()
  await page.getByLabel('Oracle conversion-rate change', { exact: true }).fill('-15')
  await page.getByLabel('Oracle conversion-rate change', { exact: true }).blur()
  const shockedHf = Number.parseFloat(await page.getByTestId('vdot-shock-hf').innerText())
  check(Math.abs(shockedHf - 0.8585) < 0.00051 && (await page.locator('[aria-label="vDOT price shock results"]').innerText()).includes('liquidatable'), 'a conversion-rate feed decline shows its effect on liquidation')
  const carry = await page.getByTestId('vdot-apr').innerText()
  await page.getByLabel('DOT / USD price move', { exact: true }).fill('50')
  await page.getByLabel('DOT / USD price move', { exact: true }).blur()
  check(await page.getByTestId('vdot-apr').innerText() === carry, 'price shocks are not added to carry APR')
  await page.waitForTimeout(800)
  const url = page.url()
  check(new URL(url).hash.includes('vd=vd2.'), 'vDOT settings receive their own versioned share token')
  const back = await open(url)
  check(await back.locator('[aria-label="vDOT carry results"]').innerText() === await page.locator('[aria-label="vDOT carry results"]').innerText(), 'vDOT share link restores the results')
  check(await back.getByLabel('DOT / USD price move', { exact: true }).inputValue() === '50', 'share link restores the stress scenario')
  await back.getByRole('button', { name: 'Two strategies', exact: true }).click()
  check(await back.getByTestId('strategy-apr').innerText() === '6.78%', 'original strategy defaults remain unchanged')
  await back.getByRole('button', { name: 'vDOT / DOT', exact: true }).click()
  check(await back.getByTestId('vdot-apr').innerText() === carry, 'vDOT assumptions survive switching tabs')
  await page.getByLabel('Loop target HF', { exact: true }).fill('1.05')
  await page.getByLabel('Loop target HF', { exact: true }).blur()
  check((await page.getByTestId('vdot-status').innerText()).includes('fails market'), 'HF target above allowed borrowing LTV is blocked')
  await page.getByRole('button', { name: 'reset vDOT assumptions', exact: true }).click()
  await page.getByLabel('DOT eMode', { exact: true }).uncheck()
  await page.getByLabel('Loop target HF', { exact: true }).fill('1.25')
  await page.getByLabel('Loop target HF', { exact: true }).blur()
  check((await page.getByTestId('vdot-status').innerText()).includes('Market checks pass'), 'standard mode uses its own borrowing limits')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'export vDOT results', exact: true }).click()
  const stream = await (await download).createReadStream()
  let text = ''
  for await (const chunk of stream) text += chunk
  const json = JSON.parse(text)
  check(json.params.useEMode === false && json.snapshot.block === '16706517' && json.quotes.quotes.length === 7 && json.oracle.crossRpcMatches && json.oracle.current.sameDotUsdSource, 'export includes mode, raw snapshot, routing and oracle evidence')
  await page.getByRole('button', { name: 'reset vDOT assumptions', exact: true }).click()
  await page.screenshot({ path: `${out}vdot-light.png`, fullPage: true })
  const mobile = await open(url, 390)
  check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout stays within the viewport')
  await mobile.screenshot({ path: `${out}vdot-mobile.png`, fullPage: true })
  const dark = await open(url, 1440, 'dark')
  await dark.screenshot({ path: `${out}vdot-dark.png`, fullPage: true })
  const invalid = await open(`${origin}#t=vdot&vd=vd3.broken`)
  check((await invalid.locator('.main > .banner').innerText()).includes('could not read vDOT settings'), 'malformed vDOT links show a visible error')
  check(await invalid.getByTestId('vdot-apr').innerText() === '4.86%', 'malformed links restore pinned defaults')
  check(errors.length === 0, `no browser errors (${errors.join(' | ')})`)
} finally {
  await browser.close()
}
