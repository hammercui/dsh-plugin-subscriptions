import React from 'react'
import { createRoot } from 'react-dom/client'
import { SubscriptionsSection } from '../src/client/SubscriptionsSection.js'
import { en } from '../src/client/locales.js'
const state = window as unknown as { failSave: boolean; saved: unknown[]; connected: boolean }
state.failSave = false; state.saved = []; state.connected = false
const rpc = { call: async (_channel: string, endpoint: string, payload: any) => {
  const action = endpoint.split('.').at(-1)
  let value: unknown = {}
  if (action === 'saveApiKey') {
    if (state.failSave) return { ok: false, error: { message: `Rejected ${payload.apiKey}` } }
    state.saved.push(payload); state.connected = true; value = { saved: true }
  } else if (action === 'status') value = { providers: Object.fromEntries(['codex','claude','grok','copilot','antigravity','zhipu','aliyun'].map(id => [id, { busy: false, accounts: id === 'aliyun' && state.connected ? [{ key: 'work', account: 'Work', isDefault: true }] : [] }])) }
  else if (action === 'usage') value = { supported: false }
  else if (action === 'proxyGet') value = { enabled: false, url: '', bypass: [], passwordSet: false }
  return { ok: true, value }
} }
createRoot(document.getElementById('root')!).render(<SubscriptionsSection rpc={rpc as never} t={(key, params) => en[key].replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))} />)
