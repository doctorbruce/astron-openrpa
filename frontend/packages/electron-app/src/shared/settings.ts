import { isProviderId } from './provider-registry'

export const SETTINGS_SCHEMA_URL = "https://opencode.ai/config.json"

export type ProviderId = string
export type ProviderTypeId = string

export type ModelSelection = {
  providerId: ProviderId
  model: string
}

export type PersistedProviderSettings = {
  providerType: ProviderTypeId
  apiKey: string
  baseUrl: string | null
  models: string[]
  defaultModel: string | null
  displayName: string | null
}

export type PersistedDefaultModel = ModelSelection

export type PersistedMcpOAuthSettings = {
  clientId?: string | null
  clientSecret?: string | null
  scope?: string | null
}

export type PersistedMcpLocalServerConfig = {
  type: 'local'
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number | null
}

export type PersistedMcpRemoteServerConfig = {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  oauth?: PersistedMcpOAuthSettings | false | null
  enabled?: boolean
  timeout?: number | null
}

export type PersistedMcpServerConfig = PersistedMcpLocalServerConfig | PersistedMcpRemoteServerConfig

export type SessionModelOverrideRecord = ModelSelection & {
  sessionID: string
  updatedAt: string
}

export type SessionModelOption = ModelSelection & {
  label: string
  providerLabel: string
}

export type SessionModelSelectionState = {
  sessionID: string
  override: ModelSelection | null
  effective: ModelSelection | null
  source: 'session' | 'assistant' | 'global' | 'none'
  options: SessionModelOption[]
}

export type PersistedAppSettings = {
  version: 1
  providers: Record<ProviderId, PersistedProviderSettings>
  defaultModel: PersistedDefaultModel | null
  mcp: Record<string, PersistedMcpServerConfig>
  sessionModelOverrides: Record<string, SessionModelOverrideRecord>
}

export type ProviderSummary = {
  providerId: ProviderId
  providerType: ProviderTypeId
  label: string
  configured: boolean
  apiKeyHint: string | null
  baseUrl: string | null
  hasBaseUrl: boolean
  models: string[]
  defaultModel: string | null
  displayName: string | null
}

export type DesktopSettings = {
  providers: ProviderSummary[]
  defaultModel: {
    providerId: ProviderId | null
    model: string
    configured: boolean
  }
  mcpServers: DesktopMcpServerSummary[]
}

export type DesktopMcpServerSummary = {
  name: string
  type: 'local' | 'remote'
  enabled: boolean
  commandPreview: string | null
  url: string | null
  hasHeaders: boolean
  hasOAuth: boolean
  timeout: number | null
}

export type DesktopMcpServerStatus =
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string }

export type SaveProviderInput = {
  providerType: ProviderTypeId
  providerId?: ProviderId | null
  apiKey?: string | null
  models?: string[] | null
  defaultModel?: string | null
  baseUrl?: string | null
  displayName?: string | null
  clear?: boolean
}

export type SaveDefaultModelInput = ModelSelection

export type SaveMcpServerInput = {
  name: string
  config: PersistedMcpServerConfig
}

export { isProviderId }
