import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ipcMain, BrowserWindow, app, dialog } from 'electron'

import {
  IPC_OPENCODE_AWAIT_INITIALIZATION,
  IPC_OPENCODE_ABORT_SESSION,
  IPC_OPENCODE_CREATE_SESSION,
  IPC_OPENCODE_DELETE_ASSISTANT,
  IPC_OPENCODE_DELETE_GROUP_ROOM,
  IPC_OPENCODE_DELETE_SKILL,
  IPC_OPENCODE_DELETE_SESSION,
  IPC_OPENCODE_GET_BOOTSTRAP,
  IPC_OPENCODE_GET_RUNTIME_STATUS,
  IPC_OPENCODE_GET_SESSION,
  IPC_OPENCODE_GET_SETTINGS,
  IPC_OPENCODE_GET_SESSION_MODEL_SELECTION,
  IPC_OPENCODE_LIST_MCP_STATUS,
  IPC_OPENCODE_LIST_ASSISTANTS,
  IPC_OPENCODE_LIST_GROUP_ROOMS,
  IPC_OPENCODE_LIST_SKILLS,
  IPC_OPENCODE_PICK_WORKSPACE,
  IPC_OPENCODE_IMPORT_SKILL,
  IPC_OPENCODE_RENAME_SESSION,
  IPC_OPENCODE_RUNTIME_EVENT,
  IPC_OPENCODE_SAVE_ASSISTANT,
  IPC_OPENCODE_SAVE_DEFAULT_MODEL,
  IPC_OPENCODE_SAVE_SESSION_MODEL_OVERRIDE,
  IPC_OPENCODE_SAVE_GROUP_ROOM,
  IPC_OPENCODE_SAVE_MCP_SERVER,
  IPC_OPENCODE_SAVE_PROVIDER,
  IPC_OPENCODE_CLEAR_SESSION_MODEL_OVERRIDE,
  IPC_OPENCODE_DELETE_MCP_SERVER,
  IPC_OPENCODE_CONNECT_MCP_SERVER,
  IPC_OPENCODE_DISCONNECT_MCP_SERVER,
  IPC_OPENCODE_SEND_MESSAGE,
} from './opencode/constants'
import type { SidecarManager } from './opencode/sidecar'
import type { RuntimeApi } from './opencode/api'
import type { RuntimeEventStream } from './opencode/events'
import type { RuntimeSkillsService } from './opencode/skills'
import type { AssistantStore } from './store/assistant-store'
import type { SettingsStore } from './store/settings-store'
import type { SessionStore } from './store/session-store'
import {
  toStudioAssistantGroups,
  toStudioSessionDetail,
  resolveDefaultSessionId,
} from './opencode/adapter'
import { createLogger } from './opencode/logging'
import { scanWorkspaceArtifacts } from './opencode/workspace-scan'
import { appendPromptSection, buildGroupMentionPrompt, buildMcpAvailabilityPrompt, resolveSessionMessageContext, resolveSessionWorkspaceContext } from './opencode/workspace-context'
import type { DesktopRuntimeEvent } from '../shared/sessions'
import type { SaveMcpServerInput } from '../shared/settings'
import type { DesktopSettings, ModelSelection, SessionModelOption, SessionModelSelectionState } from '../shared/settings'
import type {
  AssistantRecord,
  AssistantSessionRecord,
  GroupRoomRecord,
  GroupRoomSessionRecord,
} from '../shared/assistants'
import type { OpencodeSessionInfo } from '../shared/sessions'
import { getProviderDefinition } from '../shared/provider-registry'

type OpencodeIpcDeps = {
  sidecar: SidecarManager
  api: RuntimeApi
  eventStream: RuntimeEventStream
  skillsService: RuntimeSkillsService
  assistantStore: AssistantStore
  settingsStore: SettingsStore
  sessionStore: SessionStore
}

const logger = createLogger('ipc')

export function registerOpencodeIpc(deps: OpencodeIpcDeps) {
  const { sidecar, api, eventStream, skillsService, assistantStore, settingsStore, sessionStore } = deps
  let runtimeConfigDirty = false
  const markRuntimeConfigDirty = (reason: string) => {
    runtimeConfigDirty = true
    logger.info('runtime config marked dirty', {
      reason,
      runtimePhase: sidecar.getStatus().phase,
    })
  }
  const ensureFreshRuntimeConfig = async () => {
    if (!runtimeConfigDirty) {
      logger.info('runtime config already fresh before send')
      return
    }

    const runtimeStatus = sidecar.getStatus()
    if (runtimeStatus.phase !== 'ready') {
      logger.info('runtime config dirty but sidecar is not ready; next startup will use latest config', {
        runtimePhase: runtimeStatus.phase,
      })
      runtimeConfigDirty = false
      return
    }

    const statuses = await api.getSessionStatuses().catch(() => ({}))
    const busySessionIds = Object.entries(statuses)
      .filter(([, status]) => status?.type === 'busy')
      .map(([sessionId]) => sessionId)

    logger.info('ensuring fresh runtime config before send', {
      runtimePhase: runtimeStatus.phase,
      busySessionIds,
    })

    if (busySessionIds.length > 0) {
      throw new Error('助手配置刚刚变更，请先停止或等待当前运行中的会话，再继续发起新对话。')
    }

    await sidecar.restart()
    runtimeConfigDirty = false
    logger.info('restarted sidecar to apply updated opencode config')
  }
  const applyRuntimeConfigChange = async (reason: string) => {
    const runtimeStatus = sidecar.getStatus()
    if (runtimeStatus.phase !== 'ready') {
      markRuntimeConfigDirty(reason)
      return
    }

    const statuses = await api.getSessionStatuses().catch(() => ({}))
    const hasBusySession = Object.values(statuses).some(status => status?.type === 'busy')
    if (hasBusySession) {
      markRuntimeConfigDirty(reason)
      return
    }

    await sidecar.restart()
    runtimeConfigDirty = false
    logger.info('restarted sidecar to apply updated opencode config', { reason })
  }
  eventStream.subscribe((event: DesktopRuntimeEvent) => {
    sessionStore.applyEvent(event)
    broadcastToAllWindows(IPC_OPENCODE_RUNTIME_EVENT, event)
  })

  ipcMain.handle(IPC_OPENCODE_GET_RUNTIME_STATUS, () => {
    return sidecar.getStatus()
  })

  ipcMain.handle(IPC_OPENCODE_AWAIT_INITIALIZATION, async () => {
    return sidecar.awaitInitialization()
  })

  ipcMain.handle(IPC_OPENCODE_GET_BOOTSTRAP, async () => {
    const [assistants, groupRooms, sessions, assistantSessions, groupRoomSessions, skillsState] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listGroupRooms(),
      api.listSessions().catch(() => []),
      assistantStore.listAssistantSessions(),
      assistantStore.listGroupRoomSessions(),
      skillsService.getState(),
    ])

    const rootSessions = sessions.filter((s) => !s.parentID && !s.time.archived)

    const assignedRuntimeSessionIds = new Set([
      ...assistantSessions.map((s) => s.runtimeSessionId),
      ...groupRoomSessions.map((s) => s.runtimeSessionId),
    ])

    const sessionsByAssistantId = new Map<string, typeof rootSessions>()
    for (const sess of assistantSessions) {
      const runtimeSession = rootSessions.find((s) => s.id === sess.runtimeSessionId)
      const list = sessionsByAssistantId.get(sess.assistantId) ?? []
      list.push({
        ...(runtimeSession || createFallbackSessionInfo(sess.runtimeSessionId, sess.title, sess.createdAt, sess.updatedAt)),
        title: sess.title?.trim() || runtimeSession?.title || '未命名会话',
      })
      sessionsByAssistantId.set(sess.assistantId, list)
    }

    const sessionsByGroupRoomId = new Map<string, typeof rootSessions>()
    for (const sess of groupRoomSessions) {
      const runtimeSession = rootSessions.find((s) => s.id === sess.runtimeSessionId)
      const list = sessionsByGroupRoomId.get(sess.groupRoomId) ?? []
      list.push({
        ...(runtimeSession || createFallbackSessionInfo(sess.runtimeSessionId, sess.title, sess.createdAt, sess.updatedAt)),
        title: sess.title?.trim() || runtimeSession?.title || '未命名会话',
      })
      sessionsByGroupRoomId.set(sess.groupRoomId, list)
    }

    const unassignedSessions = rootSessions.filter((s) => !assignedRuntimeSessionIds.has(s.id))

    const assistantGroups = toStudioAssistantGroups(
      assistants,
      groupRooms,
      sessionsByAssistantId,
      sessionsByGroupRoomId,
      unassignedSessions,
      skillsState.skills,
    )

    logger.info('bootstrap assembled sidebar groups', {
      runtimeRootSessionIds: rootSessions.map(session => session.id),
      persistedAssistantSessionIds: assistantSessions.map(session => ({
        assistantId: session.assistantId,
        runtimeSessionId: session.runtimeSessionId,
        title: session.title,
      })),
      groups: assistantGroups.map(group => ({
        groupId: group.id,
        assistants: group.assistants.map(assistant => ({
          assistantId: assistant.id,
          sessionIds: assistant.sessions.map(session => session.id),
        })),
      })),
    })

    void writeBootstrapDebugSnapshot({
      runtimeRootSessionIds: rootSessions.map(session => session.id),
      persistedAssistantSessions: assistantSessions.map(session => ({
        assistantId: session.assistantId,
        runtimeSessionId: session.runtimeSessionId,
        title: session.title,
      })),
      persistedGroupRoomSessions: groupRoomSessions.map(session => ({
        groupRoomId: session.groupRoomId,
        runtimeSessionId: session.runtimeSessionId,
        title: session.title,
      })),
      assistantGroups,
    })

    const defaultSessionId = resolveDefaultSessionId(rootSessions)

    return { assistantGroups, defaultSessionId }
  })

  ipcMain.handle(
    IPC_OPENCODE_GET_SESSION,
    async (
      _event,
      input: string | {
        sessionId: string
        includeWorkspace?: boolean
      },
    ) => {
      const sessionId = typeof input === 'string' ? input : input.sessionId
      const includeWorkspace = typeof input === 'string' ? true : input.includeWorkspace !== false

    const [assistants, groupRooms, assistantSessions, groupRoomSessions] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listGroupRooms(),
      assistantStore.listAssistantSessions(),
      assistantStore.listGroupRoomSessions(),
    ])

    const workspaceContext = resolveSessionWorkspaceContext(
      sessionId,
      assistants,
      groupRooms,
      assistantSessions,
      groupRoomSessions,
    )
    const runtimeDirectory = workspaceContext.workspacePath?.trim() || null
    const [session, messages, statuses] = await Promise.all([
      api.getSession(sessionId, runtimeDirectory),
      api.getSessionMessages(sessionId, runtimeDirectory),
      api.getSessionStatuses().catch(() => ({})),
    ])
    const sessionBinding = resolveSessionBinding(
      sessionId,
      assistants,
      groupRooms,
      assistantSessions,
      groupRoomSessions,
    )
    const workspacePath = workspaceContext.workspacePath?.trim() || session.directory
    const workspaceSnapshot = includeWorkspace && workspacePath
      ? await scanWorkspaceArtifacts(workspacePath)
      : { workspaceFiles: [], artifacts: [] }

    return toStudioSessionDetail({
      ...session,
      title: sessionBinding.title || session.title,
    }, messages, statuses[sessionId], sessionBinding.assistantName, sessionBinding.assistantBadge, {
      mode: sessionBinding.mode,
      participantAssistantIds: sessionBinding.participantAssistantIds,
      participantAssistants: sessionBinding.participantAssistants,
      collaborationMode: sessionBinding.collaborationMode,
    }, {
      workspacePath,
      workspaceFiles: workspaceSnapshot.workspaceFiles,
      artifacts: workspaceSnapshot.artifacts,
    })
    },
  )

  ipcMain.handle(
    IPC_OPENCODE_CREATE_SESSION,
    async (_event, payload: { title?: string | null; assistantId?: string | null; groupRoomId?: string | null; workspacePath?: string | null }) => {
      const session = await api.createSession({
        title: payload?.title ?? null,
        directory: payload?.workspacePath ?? null,
      })
      if (payload?.groupRoomId) {
        await assistantStore.attachGroupRoomSession(payload.groupRoomId, session.id, session.title ?? payload?.title ?? null)
      }
      else if (payload?.assistantId) {
        await assistantStore.attachRuntimeSession(payload.assistantId, session.id, session.title ?? payload?.title ?? null)
      }
      return session
    },
  )

  ipcMain.handle(
    IPC_OPENCODE_RENAME_SESSION,
    async (_event, payload: { sessionId: string; title?: string | null }) => {
      await assistantStore.renameSession(payload.sessionId, payload.title ?? null)
      return { success: true }
    },
  )

  ipcMain.handle(IPC_OPENCODE_DELETE_SESSION, async (_event, sessionId: string) => {
    const [assistants, groupRooms, assistantSessions, groupRoomSessions] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listGroupRooms(),
      assistantStore.listAssistantSessions(),
      assistantStore.listGroupRoomSessions(),
    ])
    const workspaceContext = resolveSessionWorkspaceContext(
      sessionId,
      assistants,
      groupRooms,
      assistantSessions,
      groupRoomSessions,
    )
    await api.deleteSession(sessionId, workspaceContext.workspacePath?.trim() || null)
    await Promise.all([
      assistantStore.detachRuntimeSession(sessionId),
      assistantStore.detachGroupRoomSession(sessionId),
      settingsStore.clearSessionModelOverride(sessionId),
    ])
    return { success: true }
  })

  ipcMain.handle(IPC_OPENCODE_ABORT_SESSION, async (_event, sessionId: string) => {
    const [assistants, groupRooms, assistantSessions, groupRoomSessions] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listGroupRooms(),
      assistantStore.listAssistantSessions(),
      assistantStore.listGroupRoomSessions(),
    ])
    const workspaceContext = resolveSessionWorkspaceContext(
      sessionId,
      assistants,
      groupRooms,
      assistantSessions,
      groupRoomSessions,
    )
    await api.abortSession(sessionId, workspaceContext.workspacePath?.trim() || null)
    return { success: true }
  })

  ipcMain.handle(
    IPC_OPENCODE_SEND_MESSAGE,
    async (
      _event,
      payload: {
        sessionID: string
        text: string
        mentions?: string[]
        attachments?: Array<{
          id: string
          name: string
          mime: string
          url: string
        }>
        system?: string | null
        model?: string | null
        providerId?: string | null
      },
    ) => {
      logger.info('ipc send message requested', {
        sessionID: payload.sessionID,
        runtimeConfigDirty,
        textPreview: payload.text.slice(0, 120),
        mentionCount: payload.mentions?.length || 0,
        attachmentCount: payload.attachments?.length || 0,
      })
      await ensureFreshRuntimeConfig()
      const [assistants, groupRooms, assistantSessions, groupRoomSessions] = await Promise.all([
        assistantStore.listAssistants(),
        assistantStore.listGroupRooms(),
        assistantStore.listAssistantSessions(),
        assistantStore.listGroupRoomSessions(),
      ])
      const [settings, storedSettings, mcpStatuses] = await Promise.all([
        settingsStore.getSettings(),
        settingsStore.getStoredSettings(),
        api.getMcpStatus().catch(() => ({})),
      ])
      const context = resolveSessionMessageContext(
        payload.sessionID,
        assistants,
        groupRooms,
        assistantSessions,
        groupRoomSessions,
      )
      const workspaceContext = resolveSessionWorkspaceContext(
        payload.sessionID,
        assistants,
        groupRooms,
        assistantSessions,
        groupRoomSessions,
      )
      logger.info('resolved session message context', {
        sessionID: payload.sessionID,
        agent: context.agent ?? null,
        hasSystemPrompt: Boolean(context.system?.trim()),
        hasPayloadSystemPrompt: Boolean(payload.system?.trim()),
        workspacePath: workspaceContext.workspacePath?.trim() || null,
      })
      const sessionModelSelection = resolveSessionModelSelectionState(
        payload.sessionID,
        assistants,
        assistantSessions,
        storedSettings,
        settings,
      )
      const resolvedProviderId = payload.providerId ?? sessionModelSelection.effective?.providerId ?? null
      const resolvedModel = payload.model ?? sessionModelSelection.effective?.model ?? null
      const groupSession = groupRoomSessions.find((session) => session.runtimeSessionId === payload.sessionID)
      const groupRoom = groupSession
        ? groupRooms.find((room) => room.id === groupSession.groupRoomId) ?? null
        : null
      const mentionPrompt = buildGroupMentionPrompt(payload.mentions || [], groupRoom, assistants)
      logger.info('resolved session model selection', {
        sessionID: payload.sessionID,
        source: sessionModelSelection.source,
        override: sessionModelSelection.override,
        effective: sessionModelSelection.effective,
        requestedProviderId: payload.providerId ?? null,
        requestedModel: payload.model ?? null,
        resolvedProviderId,
        resolvedModel,
      })
      logger.info('resolved group mention context', {
        sessionID: payload.sessionID,
        groupRoomId: groupRoom?.id ?? null,
        mentions: payload.mentions ?? [],
        hasMentionPrompt: Boolean(mentionPrompt),
      })
      const mcpAvailabilityPrompt = buildMcpAvailabilityPrompt(settings.mcpServers, mcpStatuses)
      await api.sendMessage({
        sessionID: payload.sessionID,
        text: payload.text,
        directory: workspaceContext.workspacePath?.trim() || null,
        attachments: payload.attachments,
        model: resolvedModel,
        providerId: resolvedProviderId,
        agent: context.agent ?? null,
        system: appendPromptSection(
          appendPromptSection(
            appendPromptSection(payload.system ?? null, context.system ?? null) ?? null,
            mentionPrompt,
          ) ?? null,
          mcpAvailabilityPrompt,
        ) ?? null,
      })
      return { success: true }
    },
  )

  ipcMain.handle(IPC_OPENCODE_GET_SETTINGS, async () => {
    return settingsStore.getSettings()
  })

  ipcMain.handle(IPC_OPENCODE_GET_SESSION_MODEL_SELECTION, async (_event, sessionID: string) => {
    const [assistants, assistantSessions, storedSettings, settings] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listAssistantSessions(),
      settingsStore.getStoredSettings(),
      settingsStore.getSettings(),
    ])

    return resolveSessionModelSelectionState(
      sessionID,
      assistants,
      assistantSessions,
      storedSettings,
      settings,
    )
  })

  ipcMain.handle(IPC_OPENCODE_LIST_MCP_STATUS, async () => {
    return api.getMcpStatus()
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_PROVIDER, async (_event, input: Parameters<SettingsStore['saveProvider']>[0]) => {
    const result = await settingsStore.saveProvider(input)
    await sidecar.restart()
    return result
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_DEFAULT_MODEL, async (_event, input: Parameters<SettingsStore['saveDefaultModel']>[0]) => {
    const result = await settingsStore.saveDefaultModel(input)
    await sidecar.restart()
    return result
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_SESSION_MODEL_OVERRIDE, async (_event, input: { sessionID: string; providerId: string; model: string }) => {
    await settingsStore.saveSessionModelOverride(input)
    const [assistants, assistantSessions, storedSettings, settings] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listAssistantSessions(),
      settingsStore.getStoredSettings(),
      settingsStore.getSettings(),
    ])

    return resolveSessionModelSelectionState(
      input.sessionID,
      assistants,
      assistantSessions,
      storedSettings,
      settings,
    )
  })

  ipcMain.handle(IPC_OPENCODE_CLEAR_SESSION_MODEL_OVERRIDE, async (_event, sessionID: string) => {
    await settingsStore.clearSessionModelOverride(sessionID)
    const [assistants, assistantSessions, storedSettings, settings] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listAssistantSessions(),
      settingsStore.getStoredSettings(),
      settingsStore.getSettings(),
    ])

    return resolveSessionModelSelectionState(
      sessionID,
      assistants,
      assistantSessions,
      storedSettings,
      settings,
    )
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_MCP_SERVER, async (_event, input: SaveMcpServerInput) => {
    const result = await settingsStore.saveMcpServer(input)
    await applyRuntimeConfigChange(`saveMcpServer:${input.name}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_MCP_SERVER, async (_event, name: string) => {
    const result = await settingsStore.deleteMcpServer(name)
    await applyRuntimeConfigChange(`deleteMcpServer:${name}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_CONNECT_MCP_SERVER, async (_event, name: string) => {
    await api.connectMcpServer(name)
    return { success: true }
  })

  ipcMain.handle(IPC_OPENCODE_DISCONNECT_MCP_SERVER, async (_event, name: string) => {
    await api.disconnectMcpServer(name)
    return { success: true }
  })

  ipcMain.handle(IPC_OPENCODE_LIST_ASSISTANTS, async () => {
    return assistantStore.listAssistants()
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_ASSISTANT, async (_event, input: Parameters<AssistantStore['saveAssistant']>[0]) => {
    logger.info('saving assistant', {
      id: input.id,
      name: input.name,
      skillIds: input.skillIds,
    })
    const result = await assistantStore.saveAssistant(input)
    markRuntimeConfigDirty(`saveAssistant:${input.id}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_ASSISTANT, async (_event, id: string) => {
    logger.info('deleting assistant', { id })
    const result = await assistantStore.deleteAssistant(id)
    markRuntimeConfigDirty(`deleteAssistant:${id}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_LIST_GROUP_ROOMS, async () => {
    return assistantStore.listGroupRooms()
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_GROUP_ROOM, async (_event, input: Parameters<AssistantStore['saveGroupRoom']>[0]) => {
    logger.info('saving group room', {
      id: input.id,
      name: input.name,
      memberAssistantIds: input.memberAssistantIds,
    })
    const result = await assistantStore.saveGroupRoom(input)
    markRuntimeConfigDirty(`saveGroupRoom:${input.id}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_GROUP_ROOM, async (_event, id: string) => {
    logger.info('deleting group room', { id })
    const result = await assistantStore.deleteGroupRoom(id)
    markRuntimeConfigDirty(`deleteGroupRoom:${id}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_LIST_SKILLS, async () => {
    return skillsService.getState()
  })

  ipcMain.handle(IPC_OPENCODE_PICK_WORKSPACE, async (_event, currentPath?: string | null) => {
    const selection = await dialog.showOpenDialog({
      title: '选择工作空间',
      buttonLabel: '选择文件夹',
      defaultPath: typeof currentPath === 'string' && currentPath.trim() ? currentPath.trim() : undefined,
      properties: ['openDirectory', 'createDirectory'],
    })

    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true, path: null }
    }

    return {
      canceled: false,
      path: selection.filePaths[0] ?? null,
    }
  })

  ipcMain.handle(IPC_OPENCODE_IMPORT_SKILL, async () => {
    const result = await skillsService.importSkillFromDialog()
    markRuntimeConfigDirty(`importSkill:${result.skillId}`)
    return result
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_SKILL, async (_event, skillId: string) => {
    const result = await skillsService.deleteSkill(skillId)
    markRuntimeConfigDirty(`deleteSkill:${skillId}`)
    return result
  })

  return {
    cleanup: () => {
      ipcMain.removeHandler(IPC_OPENCODE_GET_RUNTIME_STATUS)
      ipcMain.removeHandler(IPC_OPENCODE_AWAIT_INITIALIZATION)
      ipcMain.removeHandler(IPC_OPENCODE_GET_BOOTSTRAP)
      ipcMain.removeHandler(IPC_OPENCODE_GET_SESSION)
      ipcMain.removeHandler(IPC_OPENCODE_CREATE_SESSION)
      ipcMain.removeHandler(IPC_OPENCODE_RENAME_SESSION)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_SESSION)
      ipcMain.removeHandler(IPC_OPENCODE_ABORT_SESSION)
      ipcMain.removeHandler(IPC_OPENCODE_SEND_MESSAGE)
      ipcMain.removeHandler(IPC_OPENCODE_GET_SETTINGS)
      ipcMain.removeHandler(IPC_OPENCODE_GET_SESSION_MODEL_SELECTION)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_MCP_STATUS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_PROVIDER)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_DEFAULT_MODEL)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_SESSION_MODEL_OVERRIDE)
      ipcMain.removeHandler(IPC_OPENCODE_CLEAR_SESSION_MODEL_OVERRIDE)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_MCP_SERVER)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_MCP_SERVER)
      ipcMain.removeHandler(IPC_OPENCODE_CONNECT_MCP_SERVER)
      ipcMain.removeHandler(IPC_OPENCODE_DISCONNECT_MCP_SERVER)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_ASSISTANTS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_ASSISTANT)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_ASSISTANT)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_GROUP_ROOMS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_GROUP_ROOM)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_GROUP_ROOM)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_SKILLS)
      ipcMain.removeHandler(IPC_OPENCODE_PICK_WORKSPACE)
      ipcMain.removeHandler(IPC_OPENCODE_IMPORT_SKILL)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_SKILL)
    },
  }
}

function resolveSessionModelSelectionState(
  sessionID: string,
  assistants: AssistantRecord[],
  assistantSessions: AssistantSessionRecord[],
  storedSettings: Awaited<ReturnType<SettingsStore['getStoredSettings']>>,
  settings: DesktopSettings,
): SessionModelSelectionState {
  const normalizedSessionID = sessionID?.trim() || ''
  const overrideRecord = storedSettings.sessionModelOverrides[normalizedSessionID] ?? null
  const override = normalizeModelSelection(storedSettings, overrideRecord)
  const assistantDefault = resolveAssistantDefaultModelForSession(normalizedSessionID, assistants, assistantSessions, storedSettings)
  const globalDefault = normalizeModelSelection(storedSettings, storedSettings.defaultModel)
  const effective = override ?? assistantDefault ?? globalDefault

  return {
    sessionID: normalizedSessionID,
    override,
    effective,
    source: override ? 'session' : assistantDefault ? 'assistant' : globalDefault ? 'global' : 'none',
    options: buildSessionModelOptions(settings),
  }
}

function normalizeModelSelection(
  storedSettings: Awaited<ReturnType<SettingsStore['getStoredSettings']>>,
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  if (!selection?.providerId || !selection.model) {
    return null
  }

  const providerSettings = storedSettings.providers[selection.providerId]
  if (!providerSettings || !providerSettings.models.includes(selection.model)) {
    return null
  }

  return {
    providerId: selection.providerId,
    model: selection.model,
  }
}

function resolveAssistantDefaultModelForSession(
  sessionID: string,
  assistants: AssistantRecord[],
  assistantSessions: AssistantSessionRecord[],
  storedSettings: Awaited<ReturnType<SettingsStore['getStoredSettings']>>,
) {
  const sessionBinding = assistantSessions.find(item => item.runtimeSessionId === sessionID)
  if (!sessionBinding) {
    return null
  }

  const assistant = assistants.find(item => item.id === sessionBinding.assistantId)
  return normalizeModelSelection(storedSettings, assistant?.defaultModel ?? null)
}

function buildSessionModelOptions(settings: DesktopSettings): SessionModelOption[] {
  return settings.providers.flatMap((provider) => {
    const providerLabel = provider.label || getProviderDefinition(provider.providerType)?.name || provider.providerId
    return provider.models.map(model => ({
      providerId: provider.providerId,
      providerLabel,
      model,
      label: `${providerLabel} / ${model}`,
    }))
  })
}

function resolveSessionBinding(
  sessionID: string,
  assistants: AssistantRecord[],
  groupRooms: GroupRoomRecord[],
  assistantSessions: AssistantSessionRecord[],
  groupRoomSessions: GroupRoomSessionRecord[],
) {
  const groupSession = groupRoomSessions.find((session) => session.runtimeSessionId === sessionID)
  if (groupSession) {
    const room = groupRooms.find((item) => item.id === groupSession.groupRoomId)
    const participantAssistants = (room?.memberAssistantIds || [])
      .map((assistantId) => assistants.find((item) => item.id === assistantId))
      .filter((assistant): assistant is AssistantRecord => Boolean(assistant))
      .map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        badge: getAssistantBadge(assistant),
      }))
    return {
      title: groupSession.title?.trim() || undefined,
      assistantName: room?.name?.trim() || 'AI 助手',
      assistantBadge: getGroupRoomBadge(room),
      mode: 'group' as const,
      participantAssistantIds: room?.memberAssistantIds?.length ? [...room.memberAssistantIds] : undefined,
      participantAssistants: participantAssistants.length ? participantAssistants : undefined,
      collaborationMode: room?.collaborationMode,
    }
  }

  const assistantSession = assistantSessions.find((session) => session.runtimeSessionId === sessionID)
  if (assistantSession) {
    const assistant = assistants.find((item) => item.id === assistantSession.assistantId)
    return {
      title: assistantSession.title?.trim() || undefined,
      assistantName: assistant?.name?.trim() || 'AI 助手',
      assistantBadge: getAssistantBadge(assistant),
      mode: 'regular' as const,
    }
  }

  return {
    title: undefined,
    assistantName: 'AI 助手',
    assistantBadge: 'AI',
    mode: 'regular' as const,
  }
}

function getAssistantBadge(assistant?: AssistantRecord) {
  const avatar = assistant?.avatar?.trim()
  if (avatar) {
    return avatar.slice(0, 1)
  }

  return assistant?.name?.trim().slice(0, 1).toUpperCase() || 'AI'
}

function getGroupRoomBadge(room?: GroupRoomRecord) {
  return room?.name?.trim().slice(0, 1).toUpperCase() || '群'
}

function broadcastToAllWindows(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function createFallbackSessionInfo(
  sessionId: string,
  title: string | null | undefined,
  createdAt: string,
  updatedAt: string,
): OpencodeSessionInfo {
  const created = Date.parse(createdAt)
  const updated = Date.parse(updatedAt)

  return {
    id: sessionId,
    slug: sessionId,
    projectID: 'persisted-session',
    directory: '',
    title: title?.trim() || '未命名会话',
    version: 'persisted',
    time: {
      created: Number.isFinite(created) ? created : Date.now(),
      updated: Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : Date.now(),
    },
  }
}

async function writeBootstrapDebugSnapshot(payload: {
  runtimeRootSessionIds: string[]
  persistedAssistantSessions: Array<{
    assistantId: string
    runtimeSessionId: string
    title: string | null | undefined
  }>
  persistedGroupRoomSessions: Array<{
    groupRoomId: string
    runtimeSessionId: string
    title: string | null | undefined
  }>
  assistantGroups: ReturnType<typeof toStudioAssistantGroups>
}) {
  try {
    const debugPath = path.join(app.getPath('userData'), 'opencode-bootstrap-debug.json')
    await writeFile(debugPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      ...payload,
    }, null, 2), 'utf8')
  }
  catch (error) {
    logger.warn('failed to write bootstrap debug snapshot', error instanceof Error ? error.message : String(error))
  }
}
