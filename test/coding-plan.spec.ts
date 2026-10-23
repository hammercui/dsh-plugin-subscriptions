import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountTokenManager } from '../src/providers/accounts.js'
import { validateModels, type ModelEntry } from '../src/providers/common.js'
import { CodingPlanAdapter, CODING_PLAN_ENDPOINTS, fetchZhipuUsage, parseZhipuUsage, ZHIPU_USAGE_ENDPOINT } from '../src/providers/coding-plan.js'
import { getAccountSession, listAccounts, saveAccountSession, setDefaultAccount, type ApiKeySession } from '../src/auth/store.js'

test('catalog modalities normalize omitted and empty fields without weakening nonempty validation', () => {
  assert.deepEqual(validateModels([{ id: 'omitted' }, { id: 'empty', inputModalities: [] }], 'test'), [
    { id: 'omitted' }, { id: 'empty' },
  ])
  const modalities: ModelEntry['inputModalities'] = ['text', 'image']
  const [validated] = validateModels([{ id: 'multimodal', inputModalities: modalities }], 'test')
  assert.deepEqual(validated.inputModalities, ['text', 'image'])
  assert.notEqual(validated.inputModalities, modalities)
  assert.deepEqual(validateModels([{ id: 'text', inputModalities: ['text'] }], 'test')[0].inputModalities, ['text'])
  assert.throws(() => validateModels([{ id: 'invalid', inputModalities: ['audio'] as unknown as NonNullable<ModelEntry['inputModalities']> }], 'test'), /inputModalities/)
  assert.throws(() => validateModels([{ id: 'mixed', inputModalities: ['text', 'audio'] as unknown as NonNullable<ModelEntry['inputModalities']> }], 'test'), /inputModalities/)
})

const session = (account: string, accessToken = 'test-key'): ApiKeySession => ({ account, accessToken, refreshToken: '', expiresAt: Number.MAX_SAFE_INTEGER })
test('API key accounts round trip, rotate in place and retain manual default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coding-plan-'))
  const path = join(dir, 'auth.json')
  try {
    await saveAccountSession('zhipu', 'personal', session('personal'), path)
    await saveAccountSession('zhipu', 'work', session('work'), path)
    await saveAccountSession('zhipu', 'personal', session('personal', 'rotated'), path)
    assert.equal((await listAccounts('zhipu', path)).length, 2)
    assert.equal((await getAccountSession('zhipu', undefined, path))?.accessToken, 'rotated')
    await setDefaultAccount('zhipu', 'work', path)
    assert.equal((await getAccountSession('zhipu', undefined, path))?.account, 'work')
    await assert.rejects(saveAccountSession('claude', 'bad', { accessToken: 'x', refreshToken: '', expiresAt: 1, scopes: '' }, path))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Zhipu parser uses only verified quota types and never fabricates zero quota', () => {
  const wrap = (limits: unknown[]) => ({ success: true, code: 200, data: { level: 'pro', limits } })
  assert.deepEqual(parseZhipuUsage(wrap([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42, nextResetTime: 1800000000000 },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 100 },
    { type: 'TIME_LIMIT', percentage: 90 },
  ])), { supported: true, plan: 'pro', windows: [{ kind: 'session', usedPercent: 42, resetsAt: 1800000000000 }, { kind: 'weekly', usedPercent: 100 }] })
  for (const value of [null, {}, wrap([]), wrap([{ type: 'TIME_LIMIT', percentage: 1 }]), wrap([{ type: 'TOKENS_LIMIT' }]), wrap([{ type: 'TOKENS_LIMIT', percentage: -1 }]), { success: false, data: { limits: [] } }]) assert.deepEqual(parseZhipuUsage(value), { supported: false })
})

test('Zhipu quota fetch uses fixed monitor endpoint and bearer header', async () => {
  const result = await fetchZhipuUsage(session('personal'), async (url, init) => {
    assert.equal(url, ZHIPU_USAGE_ENDPOINT)
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key')
    assert.equal(init?.redirect, 'error')
    return Response.json({ success: true, data: { limits: [] } })
  })
  assert.deepEqual(result, { supported: false })
})

test('Coding Plan success uses shared SSE translator and preserves tool request schema', async () => {
  const tokens = new AccountTokenManager<ApiKeySession>({ provider: 'zhipu', displayName: 'zhipu',
    makeOptions: () => ({ preemptMs: 0, refresh: async value => value, isPermanent: () => false }),
    io: { list: async () => [{ key: 'personal', session: session('personal') }], get: async () => session('personal'), save: async () => {}, remove: async () => {} },
  })
  const adapter = new CodingPlanAdapter({ provider: 'zhipu', tokens, models: [{ id: 'model' }], streamIdleTimeoutMs: 1000, fetchFn: async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { tools: { function: { name: string } }[]; messages: { content: string }[] }
    assert.equal(body.tools[0]?.function.name, 'lookup')
    assert.equal(body.messages[0]?.content, 'hello')
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'zhipu', model: 'model', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }] })) chunks.push(chunk)
  assert.match(JSON.stringify(chunks), /Hi/)
})

for (const provider of ['zhipu', 'aliyun'] as const) test(`${provider} fixed chat endpoint never rotates credentials on quota failure`, async () => {
  let refreshes = 0
  const tokens = new AccountTokenManager<ApiKeySession>({ provider, displayName: provider,
    makeOptions: () => ({ preemptMs: 0, refresh: async value => { refreshes++; return value }, isPermanent: () => false }),
    io: { list: async () => [{ key: 'personal', session: session('personal') }, { key: 'work', session: session('work', 'work-key') }], get: async key => session(key ?? 'personal', key === 'work' ? 'work-key' : 'test-key'), save: async () => {}, remove: async () => {} },
  })
  let calls = 0
  const adapter = new CodingPlanAdapter({ provider, tokens, models: [{ id: 'model' }], streamIdleTimeoutMs: 1000, fetchFn: async (url, init) => {
    calls++
    assert.equal(url, CODING_PLAN_ENDPOINTS[provider])
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer work-key')
    assert.equal(init?.redirect, 'error')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    assert.equal(body.model, 'model')
    assert.equal(body.stream, true)
    return new Response('reflected secret work-key', { status: 429 })
  } })
  await assert.rejects(async () => { for await (const _ of adapter.streamAccount({ provider, model: 'model', messages: [] }, 'work')) {} }, error => {
    assert.ok(error instanceof Error)
    assert.doesNotMatch(error.message, /work-key/)
    return true
  })
  assert.equal(calls, 1)
  assert.equal(refreshes, 0)
})
