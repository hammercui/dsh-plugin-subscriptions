import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { SubscriptionsSection, isCodingPlan, CODING_PLAN_ENDPOINTS } from '../src/client/SubscriptionsSection.js'
import { registerHooks } from 'node:module'
const css = registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: 'export default {}', shortCircuit: true } : nextLoad(url, context)
} })
const { compactSegment, retainSubscriptionSelection } = await import('../src/client/SubscriptionUsageBadge.js')
css.deregister()
import { en, zh } from '../src/client/locales.js'

test('Coding Plan settings cards use API key addition, never OAuth controls', () => {
  const html = renderToStaticMarkup(createElement(SubscriptionsSection, { rpc: {} as never }))
  for (const name of ['智谱 Coding Plan (CN)', 'Alibaba Coding Plan']) assert.ok(html.includes(name))
  for (const endpoint of Object.values(CODING_PLAN_ENDPOINTS)) assert.ok(html.includes(endpoint))
  const codingCards = html.slice(html.indexOf('智谱 Coding Plan (CN)'))
  assert.equal((codingCards.match(/Add API Key account/g) ?? []).length, 2)
  assert.ok(!codingCards.includes('>Log in<'))
  assert.ok(!codingCards.includes('Browser authorization'))
  assert.equal(isCodingPlan('zhipu'), true)
  assert.equal(isCodingPlan('aliyun'), true)
  assert.equal(isCodingPlan('codex'), false)
})

test('both Coding Plans retain badge selection; unavailable quota never becomes zero', () => {
  for (const provider of ['zhipu', 'aliyun'] as const) {
    const current = { provider, model: 'coding-model' }
    assert.deepEqual(retainSubscriptionSelection(undefined, current), current)
    const label = compactSegment({ provider, name: provider, accounts: [{ key: 'work', isDefault: true, supported: false, windows: [{ kind: 'weekly', usedPercent: 0 }] }] })
    assert.ok(label.includes(en.usageUnavailable))
    assert.ok(!label.includes('0%'))
  }
})

test('credential form uses only ephemeral password draft, required account and confirmed save response', () => {
  const source = readFileSync(new URL('../../src/client/SubscriptionsSection.tsx', import.meta.url), 'utf8')
  const form = source.slice(source.indexOf('export function CodingPlanKeyForm'), source.indexOf('/** Human text'))
  assert.match(form, /type="password" required value=\{apiKey\}/)
  assert.match(form, /required maxLength=\{80\} value=\{account\}/)
  assert.match(form, /'saveApiKey', \{ provider, account: account.trim\(\), apiKey: apiKey.trim\(\) \}/)
  assert.match(form, /result.saved !== true/)
  assert.match(form, /setAccount\(''\); setApiKey\(''\)/)
  assert.match(form, /onClick=\{clear\}/)
  assert.ok(!/localStorage|sessionStorage/.test(form))
  const manager = readFileSync(new URL('../../src/client/ProviderAccountManager.tsx', import.meta.url), 'utf8')
  assert.match(manager, /!codingPlan && <label><input type="checkbox" checked=\{preferences.poolEnabled/)
  assert.match(manager, /!codingPlan && <details>/)
  for (const dictionary of [en, zh]) {
    assert.ok(dictionary.codingPlanHint)
    assert.ok(dictionary.apiKeyAccount)
    assert.ok(dictionary.usageUnavailable)
  }
})
