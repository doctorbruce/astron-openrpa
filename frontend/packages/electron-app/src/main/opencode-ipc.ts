import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ipcMain, BrowserWindow, app } from 'electron'

import {
  IPC_OPENCODE_AWAIT_INITIALIZATION,
  IPC_OPENCODE_CREATE_SESSION,
  IPC_OPENCODE_DELETE_ASSISTANT,
  IPC_OPENCODE_DELETE_GROUP_ROOM,
  IPC_OPENCODE_DELETE_SKILL,
  IPC_OPENCODE_DELETE_SESSION,
  IPC_OPENCODE_GET_BOOTSTRAP,
  IPC_OPENCODE_GET_RUNTIME_STATUS,
  IPC_OPENCODE_GET_SESSION,
  IPC_OPENCODE_GET_SETTINGS,
  IPC_OPENCODE_LIST_ASSISTANTS,
  IPC_OPENCODE_LIST_GROUP_ROOMS,
  IPC_OPENCODE_LIST_SKILLS,
  IPC_OPENCODE_IMPORT_SKILL,
  IPC_OPENCODE_RENAME_SESSION,
  IPC_OPENCODE_RUNTIME_EVENT,
  IPC_OPENCODE_SAVE_ASSISTANT,
  IPC_OPENCODE_SAVE_DEFAULT_MODEL,
  IPC_OPENCODE_SAVE_GROUP_ROOM,
  IPC_OPENCODE_SAVE_PROVIDER,
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
import { resolveSessionMessageContext, resolveSessionWorkspaceContext } from './opencode/workspace-context'
import type { DesktopRuntimeEvent } from '../shared/sessions'
import type {
  AssistantRecord,
  AssistantSessionRecord,
  GroupRoomRecord,
  GroupRoomSessionRecord,
} from '../shared/assistants'
import type { OpencodeSessionInfo } from '../shared/sessions'

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
    const [assistants, groupRooms, sessions, assistantSessions, groupRoomSessions] = await Promise.all([
      assistantStore.listAssistants(),
      assistantStore.listGroupRooms(),
      api.listSessions().catch(() => []),
      assistantStore.listAssistantSessions(),
      assistantStore.listGroupRoomSessions(),
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
    const [session, messages] = await Promise.all([
      api.getSession(sessionId, runtimeDirectory),
      api.getSessionMessages(sessionId, runtimeDirectory),
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
    }, messages, sessionBinding.assistantName, sessionBinding.assistantBadge, {
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
    const liveSessions = await api.listSessions().catch(() => [])
    const liveRuntimeSessionIds = liveSessions
      .filter((s) => !s.parentID && !s.time.archived)
      .map((s) => s.id)
    await Promise.all([
      assistantStore.cleanupMissingRuntimeSessions(liveRuntimeSessionIds),
      assistantStore.cleanupMissingGroupRoomSessions(liveRuntimeSessionIds),
    ])
    return { success: true }
  })

  ipcMain.handle(
    IPC_OPENCODE_SEND_MESSAGE,
    async (
      _event,
      payload: {
        sessionID: string
        text: string
        attachments?: Array<{
          id: string
          name: string
          mime: string
          url: string
        }>
        model?: string | null
        providerId?: string | null
      },
    ) => {
      const [assistants, groupRooms, assistantSessions, groupRoomSessions] = await Promise.all([
        assistantStore.listAssistants(),
        assistantStore.listGroupRooms(),
        assistantStore.listAssistantSessions(),
        assistantStore.listGroupRoomSessions(),
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
      await api.sendMessage({
        sessionID: payload.sessionID,
        text: payload.text,
        directory: workspaceContext.workspacePath?.trim() || null,
        attachments: payload.attachments,
        model: payload.model ?? null,
        providerId: payload.providerId ?? null,
        agent: context.agent ?? null,
        system: context.system ?? null,
      })
      return { success: true }
    },
  )

  ipcMain.handle(IPC_OPENCODE_GET_SETTINGS, async () => {
    return settingsStore.getSettings()
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

  ipcMain.handle(IPC_OPENCODE_LIST_ASSISTANTS, async () => {
    return assistantStore.listAssistants()
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_ASSISTANT, async (_event, input: Parameters<AssistantStore['saveAssistant']>[0]) => {
    return assistantStore.saveAssistant(input)
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_ASSISTANT, async (_event, id: string) => {
    return assistantStore.deleteAssistant(id)
  })

  ipcMain.handle(IPC_OPENCODE_LIST_GROUP_ROOMS, async () => {
    return assistantStore.listGroupRooms()
  })

  ipcMain.handle(IPC_OPENCODE_SAVE_GROUP_ROOM, async (_event, input: Parameters<AssistantStore['saveGroupRoom']>[0]) => {
    return assistantStore.saveGroupRoom(input)
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_GROUP_ROOM, async (_event, id: string) => {
    return assistantStore.deleteGroupRoom(id)
  })

  ipcMain.handle(IPC_OPENCODE_LIST_SKILLS, async () => {
    return skillsService.getState()
  })

  ipcMain.handle(IPC_OPENCODE_IMPORT_SKILL, async () => {
    return skillsService.importSkillFromDialog()
  })

  ipcMain.handle(IPC_OPENCODE_DELETE_SKILL, async (_event, skillId: string) => {
    return skillsService.deleteSkill(skillId)
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
      ipcMain.removeHandler(IPC_OPENCODE_SEND_MESSAGE)
      ipcMain.removeHandler(IPC_OPENCODE_GET_SETTINGS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_PROVIDER)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_DEFAULT_MODEL)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_ASSISTANTS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_ASSISTANT)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_ASSISTANT)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_GROUP_ROOMS)
      ipcMain.removeHandler(IPC_OPENCODE_SAVE_GROUP_ROOM)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_GROUP_ROOM)
      ipcMain.removeHandler(IPC_OPENCODE_LIST_SKILLS)
      ipcMain.removeHandler(IPC_OPENCODE_IMPORT_SKILL)
      ipcMain.removeHandler(IPC_OPENCODE_DELETE_SKILL)
    },
  }
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
    return {
      title: groupSession.title?.trim() || undefined,
      assistantName: room?.name?.trim() || 'AI 助手',
      assistantBadge: getGroupRoomBadge(room),
    }
  }

  const assistantSession = assistantSessions.find((session) => session.runtimeSessionId === sessionID)
  if (assistantSession) {
    const assistant = assistants.find((item) => item.id === assistantSession.assistantId)
    return {
      title: assistantSession.title?.trim() || undefined,
      assistantName: assistant?.name?.trim() || 'AI 助手',
      assistantBadge: getAssistantBadge(assistant),
    }
  }

  return {
    title: undefined,
    assistantName: 'AI 助手',
    assistantBadge: 'AI',
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
