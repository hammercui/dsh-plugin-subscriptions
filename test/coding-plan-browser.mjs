// Isolated fixture: no network, live accounts, or real credentials.
import assert from 'node:assert/strict'
import { readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dependencies = await readdir('node_modules/.pnpm')
const packagePath = name => resolve('node_modules/.pnpm', dependencies.find(entry => entry.startsWith(`${name}@`)), 'node_modules', name)
const { build } = await import(pathToFileURL(`${packagePath('rolldown')}/dist/index.mjs`))
const { chromium } = await import(pathToFileURL(`${process.env.PLAYWRIGHT_PATH}/index.mjs`))
const result = await build({ input: 'test/coding-plan-browser.fixture.tsx', resolve: { alias: { 'react-dom/client': `${packagePath('react-dom')}/client.js` } }, transform: { define: { 'process.env.NODE_ENV': '"production"' } }, output: { format: 'iife' }, write: false })
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.setContent('<style>:root{--dsw-alias-label-primary:#20212b;--dsw-alias-label-secondary:#454956;--dsw-alias-label-tertiary:#626575;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f8f8fa;--dsw-alias-border-l2:#ddd;--dsw-alias-state-error-primary:#b42318;--dsw-alias-border-l4:#ddd}body{font:14px system-ui;margin:20px;background:var(--dsw-alias-bg-layer-1)}</style><div id="root"></div>')
  await page.addScriptTag({ content: result.output.find(f => f.type === 'chunk').code })
  const card = page.locator('div').filter({ has: page.locator('span').filter({ hasText: /^Alibaba Coding Plan$/ }) }).filter({ has: page.getByRole('button', { name: 'Add API Key account' }) }).last()
  await card.getByRole('button', { name: 'Add API Key account' }).click()
  const account = card.getByLabel('Account label (required)'); const key = card.getByLabel('Dedicated Coding Plan API Key')
  const save = card.getByRole('button', { name: 'Save', exact: true })
  assert.equal(await save.isDisabled(), true)
  await account.fill('Work'); await key.fill('fixture-dummy-key')
  assert.equal(await key.getAttribute('type'), 'password')
  await page.evaluate(() => { window.failSave = true })
  await save.click(); await card.getByRole('alert').waitFor()
  assert.equal(await key.inputValue(), 'fixture-dummy-key')
  assert.ok(!(await card.getByRole('alert').innerText()).includes('fixture-dummy-key'))
  await page.evaluate(() => { window.failSave = false })
  await save.click(); await card.getByRole('button', { name: 'Add API Key account' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.saved), [{ provider: 'aliyun', account: 'Work', apiKey: 'fixture-dummy-key' }])
  await card.getByText('Quota unavailable', { exact: false }).waitFor()
  assert.ok(!(await card.innerText()).includes('0%'))
  await card.getByRole('button', { name: 'Add API Key account' }).click()
  assert.equal(await key.inputValue(), ''); assert.equal(await account.inputValue(), '')
  await account.fill('Cancel'); await key.fill('discard-dummy')
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  await card.getByRole('button', { name: 'Add API Key account' }).click()
  assert.equal(await key.inputValue(), ''); assert.equal(await account.inputValue(), '')
  assert.equal(await page.evaluate(() => window.saved.length), 1)
  await mkdir('output', { recursive: true })
  for (const dark of [false, true]) {
    await page.evaluate(dark => { document.documentElement.style.cssText = dark ? '--dsw-alias-label-primary:#f1f1f3;--dsw-alias-label-secondary:#ddd;--dsw-alias-label-tertiary:#b6bac7;--dsw-alias-bg-layer-1:#17181b;--dsw-alias-bg-layer-2:#232429;--dsw-alias-border-l2:#454750;--dsw-alias-border-l4:#454750' : '' }, dark)
    for (const width of [900, 360]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `output/coding-plan-${dark ? 'dark' : 'light'}-${width}.png`, fullPage: true })
    }
  }
  assert.deepEqual(errors, [])
  console.log('Coding Plan browser checks passed: password masking, required fields, payload, failed-save draft/no secret reflection, success/cancel clearing, unavailable quota, responsive light/dark.')
} finally { await browser.close() }
