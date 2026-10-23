import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ApiKeyProviderId, ApiKeySession } from '../auth/store.js'
import { AccountTokenManager } from './accounts.js'
import type { AccountAwareAdapter } from './accounts.js'
import { httpLlmError, idleWatchdog, mapFetchFailure } from './common.js'
import type { FetchFn, ModelEntry, ProviderUsage, UsageWindow } from './common.js'
import { proxiedFetch } from '../http.js'
import { streamChatCompletions, toChatMessages, toChatTools } from '../translate/chat-completions.js'

export const CODING_PLAN_ENDPOINTS = {
  zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
  aliyun: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
} as const
export const ZHIPU_USAGE_ENDPOINT = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'

/** Undocumented monitor API: unknown/empty shapes are not evidence of unused quota. */
export function parseZhipuUsage(value: unknown): ProviderUsage {
  if (!value || typeof value !== 'object') return { supported: false }
  const envelope = value as Record<string, unknown>
  if (envelope.success !== true || (envelope.code !== undefined && envelope.code !== 200 && envelope.code !== 0 && envelope.code !== '200' && envelope.code !== '0')) return { supported: false }
  const data = envelope.data as Record<string, unknown> | undefined
  if (!data || !Array.isArray(data.limits)) return { supported: false }
  const windows: UsageWindow[] = []
  for (const raw of data.limits) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (row.type !== 'TOKENS_LIMIT' && row.type !== 'CREDIT_LIMIT') continue
    if (typeof row.percentage !== 'number' || !Number.isFinite(row.percentage) || row.percentage < 0 || row.percentage > 100) continue
    const kind = row.unit === 3 && row.number === 5 ? 'session' : row.unit === 6 && row.number === 1 ? 'weekly' : 'other'
    windows.push({ kind, usedPercent: row.percentage, ...(typeof row.nextResetTime === 'number' && Number.isSafeInteger(row.nextResetTime) && row.nextResetTime > 0 ? { resetsAt: row.nextResetTime } : {}) })
  }
  return windows.length ? { supported: true, windows, ...(typeof data.level === 'string' ? { plan: data.level } : {}) } : { supported: false }
}
export async function fetchZhipuUsage(session: ApiKeySession, fetchFn: FetchFn = proxiedFetch, signal?: AbortSignal): Promise<ProviderUsage> {
  const response = await fetchFn(ZHIPU_USAGE_ENDPOINT, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' }, ...(signal ? { signal } : {}), redirect: 'error' })
  if (!response.ok) throw new Error(`Zhipu quota lookup failed (HTTP ${response.status})`)
  return parseZhipuUsage(await response.json())
}

/** Fixed-endpoint adapter; deliberately no refresh, discovery, or credential failover. */
export class CodingPlanAdapter extends LlmAdapter implements AccountAwareAdapter {
  constructor(private readonly options: { provider: ApiKeyProviderId; tokens: AccountTokenManager<ApiKeySession>; models: readonly ModelEntry[]; streamIdleTimeoutMs: number; fetchFn?: FetchFn }) { super() }
  override providerInfo(provider: string) { return { id: provider, name: this.options.provider === 'zhipu' ? 'Zhipu Coding Plan (China)' : 'Alibaba Coding Plan' } }
  clearAccountCatalog(): void {}
  async listOwnModels(provider: string, account?: string): Promise<readonly LlmModelInfo[]> {
    const entries = await this.options.tokens.list()
    if (!entries.some(entry => account === undefined || entry.key === account)) return []
    return this.options.models.map(model => ({ provider, id: model.id, name: model.name ?? model.id }))
  }
  override listModels(provider: string) { return this.listOwnModels(provider) }
  async resolveOwnModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const entry = this.options.models.find(entry => entry.id === model)
    if (!entry) throw new LlmError('Unknown coding-plan model', 'NO_ADAPTER')
    return { provider, id: model, name: entry.name ?? model, inputModalities: ['text'], context: { contextWindow: entry.contextWindow ?? 128_000 }, defaultMaxTokens: entry.maxTokens ?? 8192 }
  }
  override resolveModel(provider: string, model: string) { return this.resolveOwnModel(provider, model) }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { yield* this.streamCore(options) }
  streamAccount(options: GenerateOptions, account: string): AsyncIterable<StreamChunk> { return this.streamCore(options, account) }
  private async *streamCore(options: GenerateOptions, account?: string): AsyncIterable<StreamChunk> {
    const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs)
    try {
      await this.resolveOwnModel(options.provider, options.model)
      const session = await this.options.tokens.session(account)
      const response = await (this.options.fetchFn ?? proxiedFetch)(CODING_PLAN_ENDPOINTS[this.options.provider], {
        method: 'POST', redirect: 'error', signal: watchdog.signal,
        headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, messages: toChatMessages(options.messages, options.system), stream: true, stream_options: { include_usage: true },
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
          ...(options.tools?.length ? { tools: toChatTools(options.tools), tool_choice: 'auto' } : {}),
        }),
      })
      if (!response.ok) {
        // Keep quota/error classification while redacting any reflected bearer key.
        const body = (await response.text()).split(session.accessToken).join('[REDACTED]')
        throw await httpLlmError(new Response(body, { status: response.status, headers: response.headers }), `${this.options.provider} Coding Plan`)
      }
      if (!response.body) throw new LlmError('Coding Plan returned no response body', 'TRANSPORT')
      yield* streamChatCompletions(response.body, () => watchdog.pulse())
    } catch (error) { throw mapFetchFailure('Coding Plan', error, watchdog, options.signal) }
    finally { watchdog.stop() }
  }
}
