import type { MastraRuntimeStatus } from '@hermes/shared/mastra-runs'
import { atom } from 'nanostores'

import { isBotProduct } from '@/lib/product'
import { persistBoolean, storedBoolean } from '@/lib/storage'

import { $activeGatewayProfile } from './profile'
import { $connection } from './session'

const KEY = 'hermes.desktop.mastra-supervisor.v1'

function scopeKey(): string {
  const connection = $connection.get()
  const profile = $activeGatewayProfile.get() || connection?.profile || 'default'
  const location = connection?.baseUrl || connection?.mode || 'pending'

  return `${KEY}.${encodeURIComponent(location)}.${encodeURIComponent(profile)}`
}

function defaultEnabled(): boolean {
  return isBotProduct() && $connection.get()?.mode === 'remote'
}

export const $mastraChatEnabled = atom(storedBoolean(scopeKey(), defaultEnabled()))

export function refreshMastraChatMode(): void {
  $mastraChatEnabled.set(storedBoolean(scopeKey(), defaultEnabled()))
}

export function setMastraChatEnabled(enabled: boolean): void {
  persistBoolean(scopeKey(), enabled)
  $mastraChatEnabled.set(enabled)
}

export function mastraConversationDecision(input: {
  enabled: boolean
  status: MastraRuntimeStatus
  threadId: string | null | undefined
}): 'direct-hermes' | 'mastra' | 'mastra-unavailable' {
  if (!input.enabled || !input.threadId) {return 'direct-hermes'}

  return input.status.available && input.status.capabilities.agents && input.status.capabilities.memory
    ? 'mastra'
    : 'mastra-unavailable'
}

$connection.subscribe(refreshMastraChatMode)
$activeGatewayProfile.subscribe(refreshMastraChatMode)
