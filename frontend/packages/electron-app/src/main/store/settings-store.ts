import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

import { getProviderDefinition, PROVIDER_REGISTRY } from '../../shared/provider-registry'
import { isProviderId } from '../../shared/settings'
import type {
  DesktopMcpServerSummary,
  DesktopSettings,
  PersistedAppSettings,
  PersistedMcpOAuthSettings,
  PersistedMcpServerConfig,
  PersistedProviderSettings,
  ProviderId,
  SessionModelOverrideRecord,
  SaveMcpServerInput,
  SaveDefaultModelInput,
  SaveProviderInput,
} from '../../shared/settings'
import { createLogger } from '../opencode/logging'

const SETTINGS_FILENAME = 'opencode-settings.json'
const logger = createLogger('settings-store')

export type SettingsStore = {
  getSettings: () => Promise<DesktopSettings>
  getStoredSettings: () => Promise<PersistedAppSettings>
  saveProvider: (input: SaveProviderInput) => Promise<DesktopSettings>
  saveDefaultModel: (input: SaveDefaultModelInput) => Promise<DesktopSettings>
  getSessionModelOverride: (sessionID: string) => Promise<SessionModelOverrideRecord | null>
  saveSessionModelOverride: (input: SaveDefaultModelInput & { sessionID: string }) => Promise<SessionModelOverrideRecord>
  clearSessionModelOverride: (sessionID: string) => Promise<void>
  saveMcpServer: (input: SaveMcpServerInput) => Promise<DesktopSettings>
  deleteMcpServer: (name: string) => Promise<DesktopSettings>
}

export function createSettingsStore(): SettingsStore {
  let writeQueue = Promise.resolve()

  return {
    getSettings: async () => redactSettings(await readSettingsFile()),
    getStoredSettings: async () => readSettingsFile(),
    saveProvider: async (input) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        const providerType = assertProviderType(input.providerType)
        const definition = requireProviderDefinition(providerType)
        const providerId = resolveProviderInstanceId(settings.providers, providerType, input.providerId)

        if (input.clear) {
          delete settings.providers[providerId]
          if (settings.defaultModel?.providerId === providerId) {
            settings.defaultModel = null
          }

          await writeSettingsFile(settings)
          return redactSettings(settings)
        }

        if (definition.status !== 'ready') {
          throw new Error(`${definition.name} 需要更复杂的接入方式，当前版本暂未开放。`)
        }
        if (definition.authMode !== 'api_key') {
          throw new Error(`${definition.name} 当前不支持通过此界面直接配置。`)
        }

        const existing = settings.providers[providerId]
        const nextApiKey = normalizeOptionalText(input.apiKey) ?? existing?.apiKey
        const nextBaseUrl = definition.supportsBaseUrl
          ? normalizeOptionalText(input.baseUrl) ?? existing?.baseUrl ?? null
          : existing?.baseUrl ?? null
        const nextDisplayName = definition.supportsDisplayName
          ? normalizeOptionalText(input.displayName) ?? existing?.displayName ?? buildDefaultDisplayName(definition.name, settings.providers, providerType, providerId)
          : existing?.displayName ?? null
        const nextModels = definition.supportsModel
          ? resolveProviderModels(input.models, existing?.models ?? [])
          : []
        const nextDefaultModel = definition.supportsModel
          ? resolveProviderDefaultModel(input.defaultModel, nextModels, existing?.defaultModel ?? null)
          : null

        if (!nextApiKey) {
          throw new Error(`保存 ${definition.name} 前需要填写 API 密钥。`)
        }
        if (definition.supportsModel && !nextModels.length) {
          throw new Error(`保存 ${definition.name} 前至少需要填写一个模型 ID。`)
        }
        if (definition.requiresBaseUrl && !nextBaseUrl) {
          throw new Error(`保存 ${definition.name} 前需要填写 Base URL。`)
        }

        settings.providers[providerId] = {
          providerType,
          apiKey: nextApiKey,
          baseUrl: nextBaseUrl,
          models: nextModels,
          defaultModel: nextDefaultModel,
          displayName: nextDisplayName,
        }

        if (settings.defaultModel?.providerId === providerId) {
          settings.defaultModel = nextDefaultModel ? { providerId, model: nextDefaultModel } : null
        }

        await writeSettingsFile(settings)
        return redactSettings(settings)
      }),
    saveDefaultModel: async (input) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        const providerId = normalizeRequiredText(input.providerId, '默认模型缺少服务商实例。')
        const providerSettings = settings.providers[providerId]
        if (!providerSettings) {
          throw new Error(`请先配置 ${providerId}，再将其设为默认模型。`)
        }

        const definition = requireProviderDefinition(providerSettings.providerType)
        const model = normalizeRequiredText(input.model, '默认模型不能为空。')

        if (definition.status !== 'ready') {
          throw new Error(`${definition.name} 当前还不能作为默认模型来源。`)
        }
        if (!providerSettings.apiKey) {
          throw new Error(`请先配置 ${definition.name}，再将其设为默认模型服务商。`)
        }
        if (!providerSettings.models.includes(model)) {
          throw new Error(`${definition.name} 的默认模型必须来自已保存的模型列表。`)
        }

        settings.defaultModel = { providerId, model }

        await writeSettingsFile(settings)
        return redactSettings(settings)
      }),
    getSessionModelOverride: async (sessionID) => {
      const settings = await readSettingsFile()
      return settings.sessionModelOverrides[normalizeRequiredText(sessionID, '会话 ID 不能为空。')] ?? null
    },
    saveSessionModelOverride: async (input) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        const sessionID = normalizeRequiredText(input.sessionID, '会话 ID 不能为空。')
        const providerId = normalizeRequiredText(input.providerId, '会话模型缺少服务商实例。')
        const providerSettings = settings.providers[providerId]
        if (!providerSettings) {
          throw new Error(`请先配置 ${providerId}，再保存会话模型。`)
        }

        const model = normalizeRequiredText(input.model, '会话模型不能为空。')
        if (!providerSettings.models.includes(model)) {
          throw new Error(`${providerId} 的会话模型必须来自已保存的模型列表。`)
        }

        const record: SessionModelOverrideRecord = {
          sessionID,
          providerId,
          model,
          updatedAt: new Date().toISOString(),
        }
        settings.sessionModelOverrides[sessionID] = record
        await writeSettingsFile(settings)
        return record
      }),
    clearSessionModelOverride: async (sessionID) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        delete settings.sessionModelOverrides[normalizeRequiredText(sessionID, '会话 ID 不能为空。')]
        await writeSettingsFile(settings)
      }),
    saveMcpServer: async (input) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        const name = normalizeRequiredText(input.name, 'MCP 服务名称不能为空。')
        settings.mcp[name] = validateMcpServerConfig(input.config, name)
        await writeSettingsFile(settings)
        return redactSettings(settings)
      }),
    deleteMcpServer: async (name) =>
      runSerialized(async () => {
        const settings = await readSettingsFile()
        const normalizedName = normalizeRequiredText(name, 'MCP 服务名称不能为空。')
        delete settings.mcp[normalizedName]
        await writeSettingsFile(settings)
        return redactSettings(settings)
      }),
  }

  function runSerialized<T>(task: () => Promise<T>) {
    const nextTask = writeQueue.then(task, task)
    writeQueue = nextTask.then(() => undefined, () => undefined)
    return nextTask
  }
}

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME)
}

async function readSettingsFile() {
  const filepath = getSettingsFilePath()

  try {
    const raw = await readFile(filepath, 'utf8')
    return parsePersistedSettings(raw, filepath)
  }
  catch (error) {
    if (isFileNotFound(error)) {
      return cloneDefaultSettings()
    }

    logger.warn('failed to read persisted settings', error instanceof Error ? error : String(error))
    throw createSettingsReadError(filepath, error)
  }
}

async function writeSettingsFile(settings: PersistedAppSettings) {
  const filepath = getSettingsFilePath()
  const directory = path.dirname(filepath)
  const tempPath = `${filepath}.tmp`
  const normalized = normalizePersistedSettings(settings)

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, JSON.stringify(normalized, null, 2), 'utf8')
  await rename(tempPath, filepath)
}

function normalizePersistedSettings(input: unknown): PersistedAppSettings {
  if (!isRecord(input)) {
    return cloneDefaultSettings()
  }

  const providers = isRecord(input.providers)
    ? Object.entries(input.providers).reduce<Record<ProviderId, PersistedProviderSettings>>((result, [providerId, providerSettings]) => {
        const normalizedProviderId = normalizeOptionalText(providerId)
        const normalized = normalizeProviderEntry(providerId, providerSettings)
        if (!normalizedProviderId || !normalized) {
          return result
        }

        result[normalizedProviderId] = normalized
        return result
      }, {})
    : {}

  return {
    version: 1,
    providers,
    defaultModel: normalizeDefaultModel(input.defaultModel, providers),
    mcp: normalizeMcpServers(input.mcp),
    sessionModelOverrides: normalizeSessionModelOverrides(input.sessionModelOverrides, providers),
  }
}

function parsePersistedSettings(raw: string, filepath: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    throw createSettingsReadError(filepath, error)
  }

  try {
    return validatePersistedSettings(parsed)
  }
  catch (error) {
    throw createSettingsReadError(filepath, error)
  }
}

function validatePersistedSettings(input: unknown): PersistedAppSettings {
  if (!isRecord(input)) {
    throw new Error('设置文件必须是一个 JSON 格式的对象。')
  }

  const providers = validateProviders(input.providers)
  const defaultModel = validateDefaultModel(input.defaultModel, providers)
  const mcp = validateMcpServers(input.mcp)
  const sessionModelOverrides = validateSessionModelOverrides(input.sessionModelOverrides, providers)

  return { version: 1, providers, defaultModel, mcp, sessionModelOverrides }
}

function validateProviders(input: unknown): Record<ProviderId, PersistedProviderSettings> {
  if (typeof input === 'undefined') return {}
  if (!isRecord(input)) throw new Error('设置文件中的 providers 字段必须是一个对象。')

  return Object.entries(input).reduce<Record<ProviderId, PersistedProviderSettings>>((result, [providerId, value]) => {
    const normalizedProviderId = normalizeRequiredText(providerId, '服务商实例 ID 不能为空。')
    const normalized = validateProviderEntry(normalizedProviderId, value)
    if (normalized.providerType !== 'custom-openai-compatible' && normalizedProviderId !== normalized.providerType) {
      throw new Error(`内置服务商 ${normalized.providerType} 的实例 ID 必须与 providerType 一致。`)
    }

    result[normalizedProviderId] = normalized
    return result
  }, {})
}

function validateDefaultModel(
  input: unknown,
  providers: Record<ProviderId, PersistedProviderSettings>,
): PersistedAppSettings['defaultModel'] {
  if (typeof input === 'undefined' || input === null) return null
  if (!isRecord(input)) {
    throw new Error('默认模型必须包含服务商实例 ID 与模型 ID。')
  }

  const providerId = normalizeOptionalText(input.providerId)
  const model = normalizeOptionalText(input.model)
  if (!providerId || !model) throw new Error('默认模型必须包含服务商实例 ID 与模型 ID。')
  if (!providers[providerId]?.apiKey) throw new Error(`默认模型引用了尚未配置的服务商 ${providerId}。`)
  if (!providers[providerId]?.models.includes(model)) throw new Error(`${providerId} 的默认模型必须来自已保存的模型列表。`)

  return { providerId, model }
}

function normalizeDefaultModel(
  input: unknown,
  providers: Record<ProviderId, PersistedProviderSettings>,
): PersistedAppSettings['defaultModel'] {
  if (!isRecord(input)) return null

  const providerId = normalizeOptionalText(input.providerId)
  const model = normalizeOptionalText(input.model)
  if (!providerId || !model || !providers[providerId]?.apiKey) return null
  if (!providers[providerId]?.models.includes(model)) return null

  return { providerId, model }
}

function validateSessionModelOverrides(
  input: unknown,
  providers: Record<ProviderId, PersistedProviderSettings>,
): Record<string, SessionModelOverrideRecord> {
  if (typeof input === 'undefined') return {}
  if (!isRecord(input)) throw new Error('设置文件中的 sessionModelOverrides 字段必须是一个对象。')

  return Object.entries(input).reduce<Record<string, SessionModelOverrideRecord>>((result, [sessionID, value]) => {
    const normalizedSessionID = normalizeRequiredText(sessionID, '会话模型覆盖缺少 sessionID。')
    if (!isRecord(value)) {
      throw new Error(`会话 ${normalizedSessionID} 的模型覆盖必须是一个对象。`)
    }

    const providerId = normalizeRequiredText(value.providerId, `会话 ${normalizedSessionID} 的模型覆盖缺少 providerId。`)
    const model = normalizeRequiredText(value.model, `会话 ${normalizedSessionID} 的模型覆盖缺少 model。`)
    const updatedAt = normalizeOptionalText(value.updatedAt) ?? new Date(0).toISOString()
    if (!providers[providerId]) {
      throw new Error(`会话 ${normalizedSessionID} 引用了尚未配置的服务商 ${providerId}。`)
    }
    if (!providers[providerId].models.includes(model)) {
      throw new Error(`会话 ${normalizedSessionID} 的模型 ${model} 不在已保存模型列表中。`)
    }

    result[normalizedSessionID] = { sessionID: normalizedSessionID, providerId, model, updatedAt }
    return result
  }, {})
}

function normalizeSessionModelOverrides(
  input: unknown,
  providers: Record<ProviderId, PersistedProviderSettings>,
): Record<string, SessionModelOverrideRecord> {
  if (!isRecord(input)) return {}

  return Object.entries(input).reduce<Record<string, SessionModelOverrideRecord>>((result, [sessionID, value]) => {
    const normalizedSessionID = normalizeOptionalText(sessionID)
    if (!normalizedSessionID || !isRecord(value)) {
      return result
    }

    const providerId = normalizeOptionalText(value.providerId)
    const model = normalizeOptionalText(value.model)
    if (!providerId || !model || !providers[providerId]?.models.includes(model)) {
      return result
    }

    result[normalizedSessionID] = {
      sessionID: normalizedSessionID,
      providerId,
      model,
      updatedAt: normalizeOptionalText(value.updatedAt) ?? new Date(0).toISOString(),
    }
    return result
  }, {})
}

function redactSettings(settings: PersistedAppSettings): DesktopSettings {
  const providerOrder = new Map(PROVIDER_REGISTRY.map((definition, index) => [definition.id, index]))

  return {
    providers: Object.entries(settings.providers)
      .sort(([leftId, leftSettings], [rightId, rightSettings]) => {
        const leftOrder = providerOrder.get(leftSettings.providerType) ?? Number.MAX_SAFE_INTEGER
        const rightOrder = providerOrder.get(rightSettings.providerType) ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) return leftOrder - rightOrder
        return leftId.localeCompare(rightId)
      })
      .map(([providerId, providerSettings]) => {
        const definition = requireProviderDefinition(providerSettings.providerType)
        return {
          providerId,
          providerType: providerSettings.providerType,
          label: providerSettings.displayName || definition.name,
          configured: Boolean(providerSettings.apiKey),
          apiKeyHint: providerSettings.apiKey ? maskApiKey(providerSettings.apiKey) : null,
          baseUrl: providerSettings.baseUrl ?? null,
          hasBaseUrl: Boolean(providerSettings.baseUrl),
          models: providerSettings.models,
          defaultModel: providerSettings.defaultModel ?? null,
          displayName: providerSettings.displayName ?? null,
        }
      }),
    defaultModel: {
      providerId: settings.defaultModel?.providerId ?? null,
      model: settings.defaultModel?.model ?? '',
      configured: Boolean(settings.defaultModel),
    },
    mcpServers: Object.entries(settings.mcp)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, config]) => toDesktopMcpServerSummary(name, config)),
  }
}

function cloneDefaultSettings(): PersistedAppSettings {
  return { version: 1, providers: {}, defaultModel: null, mcp: {}, sessionModelOverrides: {} }
}

function createSettingsReadError(filepath: string, cause: unknown) {
  return new Error(`无法安全读取已保存的设置文件：${filepath}。请先修复或删除该文件，再继续保存设置。`, {
    cause: cause instanceof Error ? cause : undefined,
  })
}

function maskApiKey(value: string) {
  const visible = value.slice(-4)
  return visible ? `已保存密钥，尾号 ${visible}` : '已保存密钥'
}

function normalizeProviderEntry(providerId: string, input: unknown): PersistedProviderSettings | null {
  if (!isRecord(input)) return null

  const providerType = normalizePersistedProviderType(providerId, input.providerType)
  if (!providerType) return null

  const apiKey = normalizeOptionalText(input.apiKey)
  if (!apiKey) return null

  const definition = requireProviderDefinition(providerType)
  const models = normalizePersistedProviderModels(input.models, input.model)
  if (definition.supportsModel && !models.length) {
    return null
  }

  return {
    providerType,
    apiKey,
    baseUrl: normalizeOptionalText(input.baseUrl) ?? null,
    models,
    defaultModel: resolveProviderDefaultModel(
      normalizeOptionalText(input.defaultModel),
      models,
      normalizeOptionalText(input.model),
    ),
    displayName: normalizeOptionalText(input.displayName) ?? null,
  }
}

function validateProviderEntry(providerId: string, input: unknown): PersistedProviderSettings {
  if (!isRecord(input)) {
    throw new Error(`${providerId} 的服务商配置必须是一个对象。`)
  }

  const providerType = normalizePersistedProviderType(providerId, input.providerType)
  if (!providerType) {
    throw new Error(`设置中包含不支持的服务商：${providerId}`)
  }

  const definition = requireProviderDefinition(providerType)
  const apiKey = normalizeOptionalText(input.apiKey)
  const models = normalizePersistedProviderModels(input.models, input.model)
  const displayName = normalizeOptionalText(input.displayName)

  if (!apiKey) throw new Error(`服务商 ${providerId} 缺少已保存的 API 密钥。`)
  if (definition.supportsModel && !models.length) throw new Error(`服务商 ${providerId} 至少需要一个模型 ID。`)
  if (definition.requiresBaseUrl && !normalizeOptionalText(input.baseUrl)) {
    throw new Error(`服务商 ${providerId} 缺少已保存的 Base URL。`)
  }

  return {
    providerType,
    apiKey,
    baseUrl: normalizeOptionalText(input.baseUrl) ?? null,
    models,
    defaultModel: resolveProviderDefaultModel(
      normalizeOptionalText(input.defaultModel),
      models,
      normalizeOptionalText(input.model),
    ),
    displayName: displayName ?? null,
  }
}

function normalizePersistedProviderType(providerId: string, input: unknown) {
  const explicit = normalizeOptionalText(input)
  if (explicit && isProviderId(explicit)) {
    return explicit
  }

  const keyPrefix = providerId.split(':', 1)[0]?.trim()
  if (keyPrefix && isProviderId(keyPrefix)) {
    return keyPrefix
  }

  const normalizedProviderId = normalizeOptionalText(providerId)
  if (normalizedProviderId && isProviderId(normalizedProviderId)) {
    return normalizedProviderId
  }

  return null
}

function resolveProviderInstanceId(
  providers: Record<ProviderId, PersistedProviderSettings>,
  providerType: string,
  inputProviderId?: string | null,
) {
  const explicit = normalizeOptionalText(inputProviderId)
  if (explicit) {
    return explicit
  }

  if (!allowsMultipleProviderInstances(providerType)) {
    return providerType
  }

  let index = 1
  while (providers[`${providerType}:${index}`]) {
    index += 1
  }

  return `${providerType}:${index}`
}

function allowsMultipleProviderInstances(providerType: string) {
  return providerType === 'custom-openai-compatible'
}

function buildDefaultDisplayName(
  providerName: string,
  providers: Record<ProviderId, PersistedProviderSettings>,
  providerType: string,
  providerId: string,
) {
  if (!allowsMultipleProviderInstances(providerType)) {
    return providerName
  }

  const fallbackIndex = Object.values(providers).filter(item => item.providerType === providerType).length + 1
  const suffix = providerId.split(':').slice(1).join(':') || String(fallbackIndex)
  return `${providerName} ${suffix}`
}

function resolveProviderModels(input: string[] | null | undefined, existing: string[]) {
  if (typeof input === 'undefined') {
    return [...existing]
  }

  const models = Array.isArray(input)
    ? input.map(item => normalizeOptionalText(item)).filter((item): item is string => Boolean(item))
    : []

  return [...new Set(models)]
}

function normalizePersistedProviderModels(modelsInput: unknown, legacyModelInput: unknown) {
  const models = Array.isArray(modelsInput)
    ? modelsInput.map(item => normalizeOptionalText(item)).filter((item): item is string => Boolean(item))
    : []
  const legacyModel = normalizeOptionalText(legacyModelInput)
  if (legacyModel && !models.includes(legacyModel)) {
    models.unshift(legacyModel)
  }
  return [...new Set(models)]
}

function resolveProviderDefaultModel(input: string | null | undefined, models: string[], existing: string | null) {
  const requested = normalizeOptionalText(input)
  if (requested && models.includes(requested)) {
    return requested
  }
  if (existing && models.includes(existing)) {
    return existing
  }
  return models[0] ?? null
}

function normalizeMcpServers(input: unknown): Record<string, PersistedMcpServerConfig> {
  if (!isRecord(input)) return {}

  return Object.entries(input).reduce<Record<string, PersistedMcpServerConfig>>((result, [name, config]) => {
    const normalizedName = normalizeOptionalText(name)
    if (!normalizedName) return result
    try {
      result[normalizedName] = validateMcpServerConfig(config, normalizedName)
    }
    catch {
      return result
    }
    return result
  }, {})
}

function validateMcpServers(input: unknown): Record<string, PersistedMcpServerConfig> {
  if (typeof input === 'undefined') return {}
  if (!isRecord(input)) throw new Error('设置文件中的 mcp 字段必须是一个对象。')

  return Object.entries(input).reduce<Record<string, PersistedMcpServerConfig>>((result, [name, config]) => {
    const normalizedName = normalizeRequiredText(name, 'MCP 服务名称不能为空。')
    result[normalizedName] = validateMcpServerConfig(config, normalizedName)
    return result
  }, {})
}

function validateMcpServerConfig(input: unknown, name: string): PersistedMcpServerConfig {
  if (!isRecord(input)) {
    throw new Error(`MCP 服务 ${name} 的配置必须是一个对象。`)
  }

  if (input.type === 'local') {
    return validateLocalMcpConfig(input, name)
  }

  if (input.type === 'remote') {
    return validateRemoteMcpConfig(input, name)
  }

  throw new Error(`MCP 服务 ${name} 的 type 只支持 local 或 remote。`)
}

function validateLocalMcpConfig(input: Record<string, unknown>, name: string): PersistedMcpServerConfig {
  const command = Array.isArray(input.command)
    ? input.command.map(item => normalizeOptionalText(item)).filter((item): item is string => Boolean(item))
    : []

  if (!command.length) {
    throw new Error(`本地 MCP 服务 ${name} 至少需要一个 command。`)
  }

  return {
    type: 'local',
    command,
    environment: normalizeStringRecord(input.environment),
    enabled: normalizeOptionalBoolean(input.enabled),
    timeout: normalizeOptionalPositiveInt(input.timeout),
  }
}

function validateRemoteMcpConfig(input: Record<string, unknown>, name: string): PersistedMcpServerConfig {
  const url = normalizeRequiredText(input.url, `远程 MCP 服务 ${name} 缺少 URL。`)

  return {
    type: 'remote',
    url,
    headers: normalizeStringRecord(input.headers),
    oauth: normalizeMcpOAuth(input.oauth),
    enabled: normalizeOptionalBoolean(input.enabled),
    timeout: normalizeOptionalPositiveInt(input.timeout),
  }
}

function normalizeMcpOAuth(input: unknown): PersistedMcpOAuthSettings | false | undefined {
  if (input === false) return false
  if (!isRecord(input)) return undefined

  const clientId = normalizeOptionalText(input.clientId)
  const clientSecret = normalizeOptionalText(input.clientSecret)
  const scope = normalizeOptionalText(input.scope)

  if (!clientId && !clientSecret && !scope) {
    return {}
  }

  return {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(scope ? { scope } : {}),
  }
}

function normalizeStringRecord(input: unknown) {
  if (!isRecord(input)) return undefined

  const entries = Object.entries(input).reduce<Record<string, string>>((result, [key, value]) => {
    const normalizedKey = normalizeOptionalText(key)
    const normalizedValue = normalizeOptionalText(value)
    if (!normalizedKey || !normalizedValue) return result
    result[normalizedKey] = normalizedValue
    return result
  }, {})

  return Object.keys(entries).length ? entries : undefined
}

function normalizeOptionalBoolean(input: unknown) {
  return typeof input === 'boolean' ? input : undefined
}

function normalizeOptionalPositiveInt(input: unknown) {
  if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) return undefined
  return input
}

function toDesktopMcpServerSummary(name: string, config: PersistedMcpServerConfig): DesktopMcpServerSummary {
  return {
    name,
    type: config.type,
    enabled: config.enabled !== false,
    commandPreview: config.type === 'local' ? config.command.join(' ') : null,
    url: config.type === 'remote' ? config.url : null,
    hasHeaders: config.type === 'remote' ? Boolean(config.headers && Object.keys(config.headers).length) : false,
    hasOAuth: config.type === 'remote' ? config.oauth !== false && Boolean(config.oauth) : false,
    timeout: typeof config.timeout === 'number' ? config.timeout : null,
  }
}

function assertProviderType(providerType: string) {
  if (!isProviderId(providerType)) {
    throw new Error(`不支持的服务商：${providerType}`)
  }

  return providerType
}

function requireProviderDefinition(providerId: string) {
  const definition = getProviderDefinition(providerId)
  if (!definition) {
    throw new Error(`不支持的服务商：${providerId}`)
  }
  return definition
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeRequiredText(value: unknown, message: string) {
  const normalized = normalizeOptionalText(value)
  if (!normalized) throw new Error(message)
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFileNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
