import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getOpencodeDesktopApi, opencodeAIStudioProvider } from '@/views/AIStudio/providers/opencodeProvider'

import type {
  AIStudioCardActionPayload,
  AIStudioChoiceSubmissionPayload,
  AIStudioParamSubmissionPayload,
  AIStudioSendMessagePayload,
  AIStudioSessionMutationResult,
} from '@/views/AIStudio/contracts'
import type {
  StudioAssistant,
  StudioAssistantGroup,
  StudioCollaborationMode,
  StudioMessage,
  StudioSession,
  StudioSessionDetail,
  StudioSessionModelSelectionState,
} from '@/views/AIStudio/types'

const provider = opencodeAIStudioProvider
const INITIAL_SESSION_ID = ''

type PendingMutation = {
  sessionId: string
  kind: 'message' | 'choice' | 'param' | 'action'
  cardId?: string
  actionId?: string
} | null

type CreateAssistantPayload = {
  name: string
  workspacePath?: string
  persona?: string
  capabilities?: string
  skills?: string[]
  templateKind?: 'assistant' | 'group'
  groupParticipantAssistantIds?: string[]
  groupCollaborationMode?: StudioCollaborationMode
}

type CreateSessionOptions = {
  workspacePath?: string
  title?: string
  seedPrompt?: string
}

function cloneGroups(groups: StudioAssistantGroup[]) {
  return groups.map(group => ({
    ...group,
    assistants: group.assistants.map(assistant => ({
      ...assistant,
      sessions: assistant.sessions.map(session => ({ ...session })),
    })),
  }))
}

function extractSessionIds(groups: StudioAssistantGroup[]) {
  return new Set(
    groups.flatMap(group =>
      group.assistants.flatMap(assistant => assistant.sessions.map(session => session.id)),
    ),
  )
}

  function normalizeSessionDetail(detail: StudioSessionDetail): StudioSessionDetail {
    return {
      ...detail,
      selectedArtifactId: detail.selectedArtifactId || detail.artifacts[0]?.id,
    }
  }

  function mergeWorkspaceSnapshot(
    previous: StudioSessionDetail | undefined,
    next: StudioSessionDetail,
    includeWorkspace: boolean,
  ): StudioSessionDetail {
    if (includeWorkspace || !previous)
      return next

    return {
      ...next,
      workspacePath: next.workspacePath || previous.workspacePath,
      workspaceFiles: previous.workspaceFiles,
      artifacts: previous.artifacts,
      workspacePreview: previous.workspacePreview,
      selectedArtifactId: previous.selectedArtifactId || next.selectedArtifactId,
    }
  }

export const useAIStudioStore = defineStore('aiStudio', () => {
  const assistantGroups = ref<StudioAssistantGroup[]>([])
  const sessionMap = ref<Record<string, StudioSessionDetail>>({})
  const activeSessionId = ref(INITIAL_SESSION_ID)
  const activeSessionLoading = ref(false)
  const activeSurface = ref<'main' | 'automation' | 'settings'>('main')
  const workspaceOpen = ref(false)
  const invitedAssistants = ref<string[]>([])
  const showNewAssistant = ref(false)
  const assistantModalMode = ref<'create' | 'edit'>('create')
  const assistantTemplateKind = ref<'assistant' | 'group'>('assistant')
  const editingAssistantId = ref<string | null>(null)
  const showInviteAssistant = ref(false)
  const initialized = ref(false)
  const loading = ref(false)
  const errorMessage = ref('')
  const pendingMutation = ref<PendingMutation>(null)
  const isAiTyping = ref(false)
  const sessionModelSelection = ref<StudioSessionModelSelectionState | null>(null)
  const focusedAssistantId = ref<string | null>(null)
  const showBuiltinWelcome = ref(false)
  let runtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let runtimeRefreshInFlight = false
  let queuedRuntimeRefreshSessionId: string | null = null

  const activeSession = computed(() => {
    if (!activeSessionId.value)
      return null
    return sessionMap.value[activeSessionId.value] || null
  })

  const newSessionParticipantCandidates = computed(() => {
    const singleGroup = assistantGroups.value.find(group => group.id === 'single')
    return (singleGroup?.assistants || [])
      .filter(assistant => !assistant.isBuiltin)
      .map(assistant => ({
        id: assistant.id,
        name: assistant.name,
        badge: assistant.badge,
      }))
  })

  const isActiveSessionPending = computed(() => pendingMutation.value?.sessionId === activeSessionId.value)
  const editingAssistant = computed(() => {
    if (!editingAssistantId.value)
      return null
    return findAssistantById(editingAssistantId.value)
  })

  function listAllSessions() {
    return assistantGroups.value.flatMap(group =>
      group.assistants.flatMap(assistant =>
        assistant.sessions.map(session => ({
          assistantId: assistant.id,
          sessionId: session.id,
          session,
        })),
      ),
    )
  }

  function findAssistantById(assistantId: string) {
    for (const group of assistantGroups.value) {
      const assistant = group.assistants.find(item => item.id === assistantId)
      if (assistant)
        return assistant
    }
    return null
  }

  function getAssistantSessionIds(assistantId: string) {
    return findAssistantById(assistantId)?.sessions.map(session => session.id) || []
  }

  function findAssistantIdBySession(sessionId: string) {
    for (const group of assistantGroups.value) {
      for (const assistant of group.assistants) {
        if (assistant.sessions.some(session => session.id === sessionId))
          return assistant.id
      }
    }
    return null
  }

  function getFirstAvailableSessionId(preferredAssistantId?: string) {
    if (preferredAssistantId) {
      const preferredSessionId = getAssistantSessionIds(preferredAssistantId)[0]
      if (preferredSessionId)
        return preferredSessionId
    }

    return listAllSessions()[0]?.sessionId || ''
  }

  function updateSessionDetail(detail: StudioSessionDetail) {
    const previous = sessionMap.value[detail.id]
    const next = normalizeSessionDetail({
      ...detail,
      selectedArtifactId: detail.selectedArtifactId || previous?.selectedArtifactId,
    })
    syncSessionTitle(detail.id, next.headerTitle)
    sessionMap.value = {
      ...sessionMap.value,
      [next.id]: next,
    }
    return next
  }

  function mutateSessionDetail(sessionId: string, mapper: (session: StudioSessionDetail) => StudioSessionDetail) {
    const current = sessionMap.value[sessionId]
    if (!current)
      return null
    updateSessionDetail(mapper(current))
  }

  function mutateAssistant(assistantId: string, mapper: (assistant: StudioAssistant) => StudioAssistant) {
    assistantGroups.value = assistantGroups.value.map(group => ({
      ...group,
      assistants: group.assistants.map(assistant => assistant.id === assistantId ? mapper(assistant) : assistant),
    }))
  }

  async function refreshBootstrap(preferredSessionId = activeSessionId.value) {
    const bootstrap = await provider.getBootstrap()
    const nextGroups = cloneGroups(bootstrap.assistantGroups)
    const availableSessionIds = extractSessionIds(nextGroups)
    const nextSessionId = preferredSessionId && availableSessionIds.has(preferredSessionId)
      ? preferredSessionId
      : bootstrap.defaultSessionId || [...availableSessionIds][0] || INITIAL_SESSION_ID

    assistantGroups.value = nextGroups
    activeSessionId.value = nextSessionId

    if (!nextSessionId) {
      sessionMap.value = {}
      sessionModelSelection.value = null
      return null
    }

    if (!sessionMap.value[nextSessionId])
      await loadSessionDetail(nextSessionId, { force: true, includeWorkspace: false })
    await loadSessionModelSelection(nextSessionId)
    return nextSessionId
  }

  function touchSession(sessionId: string) {
    const assistantId = findAssistantIdBySession(sessionId)
    if (!assistantId)
      return null

    mutateAssistant(assistantId, assistant => ({
      ...assistant,
      sessions: assistant.sessions.map(session => (
        session.id === sessionId
          ? { ...session, time: '刚刚' }
          : session
      )),
    }))
  }

  function syncSessionTitle(sessionId: string, title: string) {
    const assistantId = findAssistantIdBySession(sessionId)
    if (!assistantId)
      return

    mutateAssistant(assistantId, assistant => ({
      ...assistant,
      sessions: assistant.sessions.map(session => (
        session.id === sessionId
          ? { ...session, title }
          : session
      )),
    }))
  }

  async function loadSessionDetail(
    sessionId: string,
    options: { force?: boolean, includeWorkspace?: boolean } = {},
  ) {
    if (!options.force && sessionMap.value[sessionId])
      return sessionMap.value[sessionId]

    const includeWorkspace = options.includeWorkspace !== false
    const detail = await provider.getSessionDetail(sessionId, { includeWorkspace })
    const mergedDetail = mergeWorkspaceSnapshot(sessionMap.value[sessionId], detail, includeWorkspace)
    return updateSessionDetail(mergedDetail)
  }

  async function loadSessionModelSelection(sessionId: string) {
    if (!sessionId) {
      sessionModelSelection.value = null
      return null
    }

    const selection = await getOpencodeDesktopApi().getSessionModelSelection(sessionId) as StudioSessionModelSelectionState
    if (activeSessionId.value === sessionId)
      sessionModelSelection.value = selection
    return selection
  }

  async function runMutation(meta: NonNullable<PendingMutation>, task: () => Promise<AIStudioSessionMutationResult>) {
    pendingMutation.value = meta
    errorMessage.value = ''

    try {
      const result = await task()
      const session = updateSessionDetail(result.session)
      touchSession(session.id)
      return session
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'AI Studio 交互提交失败'
      throw error
    }
    finally {
      pendingMutation.value = null
    }
  }

  async function ensureInitialized(sessionId = INITIAL_SESSION_ID) {
    loading.value = true
    errorMessage.value = ''

    try {
      if (!initialized.value) {
        const bootstrap = await provider.getBootstrap()
        assistantGroups.value = cloneGroups(bootstrap.assistantGroups)
        const builtinAssistantId = bootstrap.assistantGroups.find(group => group.id === 'builtin')?.assistants[0]?.id || null
        if (!sessionId && builtinAssistantId) {
          activeSessionId.value = INITIAL_SESSION_ID
          focusedAssistantId.value = builtinAssistantId
          showBuiltinWelcome.value = true
        }
        else {
          activeSessionId.value = sessionId || bootstrap.defaultSessionId || INITIAL_SESSION_ID
          if (activeSessionId.value) {
            showBuiltinWelcome.value = false
          }
        }
        initialized.value = true
      }
      else {
        activeSessionId.value = sessionId || activeSessionId.value || INITIAL_SESSION_ID
        if (sessionId) {
          showBuiltinWelcome.value = false
        }
      }

      if (activeSessionId.value) {
        activeSessionLoading.value = true
        await loadSessionDetail(activeSessionId.value, { includeWorkspace: false })
        await loadSessionModelSelection(activeSessionId.value)
        activeSessionLoading.value = false
      }
      else {
        sessionModelSelection.value = null
      }
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'AI Studio 数据初始化失败'
    }
    finally {
      activeSessionLoading.value = false
      loading.value = false
    }
  }

  async function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId || INITIAL_SESSION_ID
    if (activeSessionId.value)
      showBuiltinWelcome.value = false
    workspaceOpen.value = false
    invitedAssistants.value = []
    isAiTyping.value = false
    if (!activeSessionId.value) {
      sessionModelSelection.value = null
      return
    }
    void loadSessionModelSelection(activeSessionId.value)
    if (sessionMap.value[activeSessionId.value])
      return

    activeSessionLoading.value = true
    try {
      await loadSessionDetail(activeSessionId.value, {
        includeWorkspace: workspaceOpen.value,
      })
    }
    finally {
      activeSessionLoading.value = false
    }
  }

  function openSurface(surface: 'main' | 'automation' | 'settings') {
    activeSurface.value = surface
    if (surface === 'main' && activeSessionId.value)
      void loadSessionModelSelection(activeSessionId.value)
  }

  function toggleWorkspace() {
    const nextValue = !workspaceOpen.value
    workspaceOpen.value = nextValue
    if (nextValue && activeSessionId.value)
      void loadSessionDetail(activeSessionId.value, { force: true, includeWorkspace: true })
  }

  function setWorkspaceOpen(value: boolean) {
    workspaceOpen.value = value
    if (value && activeSessionId.value)
      void loadSessionDetail(activeSessionId.value, { force: true, includeWorkspace: true })
  }

  function openNewAssistant() {
    assistantModalMode.value = 'create'
    assistantTemplateKind.value = 'assistant'
    editingAssistantId.value = null
    showNewAssistant.value = true
  }

  function openNewGroupTemplate() {
    assistantModalMode.value = 'create'
    assistantTemplateKind.value = 'group'
    editingAssistantId.value = null
    showNewAssistant.value = true
  }

  function openEditAssistant(assistantId: string) {
    assistantModalMode.value = 'edit'
    editingAssistantId.value = assistantId
    assistantTemplateKind.value = findAssistantById(assistantId)?.status === '群聊' ? 'group' : 'assistant'
    showNewAssistant.value = true
  }

  function closeNewAssistant() {
    showNewAssistant.value = false
    assistantModalMode.value = 'create'
    assistantTemplateKind.value = 'assistant'
    editingAssistantId.value = null
  }

  function openInviteAssistant() {
    showInviteAssistant.value = true
  }

  function closeInviteAssistant() {
    showInviteAssistant.value = false
  }

  function inviteAssistants(ids: string[]) {
    invitedAssistants.value = [...new Set([...invitedAssistants.value, ...ids])]
    showInviteAssistant.value = false
  }

  function updateAssistantSessionDetails(
    assistantId: string,
    updater: (detail: StudioSessionDetail) => StudioSessionDetail,
  ) {
    const sessionIds = new Set(getAssistantSessionIds(assistantId))
    sessionMap.value = Object.fromEntries(
      Object.entries(sessionMap.value).map(([key, detail]) => [
        key,
        sessionIds.has(key) ? normalizeSessionDetail(updater(detail)) : detail,
      ]),
    )
  }

  async function createAssistant(payload: CreateAssistantPayload) {
    const name = payload.name.trim()
    const isGroupTemplate = payload.templateKind === 'group'
    const api = getOpencodeDesktopApi()
    if (isGroupTemplate) {
      const saved = await api.saveGroupRoom({
        name,
        description: payload.capabilities?.trim() || null,
        coordinatorPrompt: payload.persona?.trim() || null,
        memberAssistantIds: [...new Set((payload.groupParticipantAssistantIds || []).filter(Boolean))],
        collaborationMode: payload.groupCollaborationMode || 'auto',
        workspacePath: payload.workspacePath?.trim() || null,
      }) as { id: string }
      await refreshBootstrap()
      activeSurface.value = 'main'
      workspaceOpen.value = false
      closeNewAssistant()
      return { assistantId: saved.id }
    }

    const saved = await api.saveAssistant({
      name,
      description: payload.capabilities?.trim() || null,
      systemPrompt: payload.persona?.trim() || null,
      skillIds: payload.skills || [],
      workspacePath: payload.workspacePath?.trim() || null,
    }) as { id: string }
    await refreshBootstrap()
    activeSurface.value = 'main'
    workspaceOpen.value = false
    closeNewAssistant()
    return { assistantId: saved.id }
  }

  async function updateAssistant(assistantId: string, payload: CreateAssistantPayload) {
    const currentAssistant = findAssistantById(assistantId)
    if (!currentAssistant)
      return null
    
    const nextName = payload.name.trim()
    const isGroupTemplate = payload.templateKind === 'group'
      || !!currentAssistant.groupParticipantAssistantIds?.length
      || !!currentAssistant.groupCollaborationMode
    const normalizedGroupParticipants = isGroupTemplate
      ? [...new Set((payload.groupParticipantAssistantIds || currentAssistant.groupParticipantAssistantIds || []).filter(Boolean))]
      : undefined

    const api = getOpencodeDesktopApi()
    if (isGroupTemplate) {
      await api.saveGroupRoom({
        id: assistantId,
        name: nextName,
        description: payload.capabilities?.trim() || null,
        coordinatorPrompt: payload.persona?.trim() || null,
        memberAssistantIds: normalizedGroupParticipants,
        collaborationMode: payload.groupCollaborationMode || currentAssistant.groupCollaborationMode || 'auto',
        workspacePath: payload.workspacePath?.trim() || null,
      })
    }
    else {
      await api.saveAssistant({
        id: assistantId,
        name: nextName,
        description: payload.capabilities?.trim() || null,
        systemPrompt: payload.persona?.trim() || null,
        skillIds: payload.skills?.length ? [...payload.skills] : [],
        workspacePath: payload.workspacePath?.trim() || null,
      })
    }

    await refreshBootstrap(activeSessionId.value)
    closeNewAssistant()
    return assistantId
  }

  async function createSessionForAssistant(assistantId: string, options: CreateSessionOptions = {}) {
    const targetAssistant = findAssistantById(assistantId)
    if (!targetAssistant)
      return null

    const workspacePath = options.workspacePath?.trim() || targetAssistant.workspacePath?.trim() || '~/Documents'
    const isGroupSession = !!targetAssistant.groupParticipantAssistantIds?.length || !!targetAssistant.groupCollaborationMode
    const title = isGroupSession
      ? `${targetAssistant.name} 群聊会话`
      : `${targetAssistant.name} 新会话`

    const resolvedTitle = options.title?.trim() || title
    const result = await provider.createSession!({
      assistantId: isGroupSession ? '' : targetAssistant.id,
      title: resolvedTitle,
      workspacePath,
      agentId: isGroupSession ? targetAssistant.id : undefined,
    })
    const createdDetail = updateSessionDetail({
      ...result.session,
      workspacePath: result.session.workspacePath || workspacePath,
    })
    const createdSession: StudioSession = {
      id: createdDetail.id,
      title: createdDetail.headerTitle || resolvedTitle,
      time: '刚刚',
    }

    mutateAssistant(targetAssistant.id, assistant => ({
      ...assistant,
      sessions: [createdSession, ...assistant.sessions],
    }))

    const seedPrompt = options.seedPrompt?.trim()
    if (seedPrompt) {
      try {
        await provider.sendMessage({
          sessionId: createdDetail.id,
          content: seedPrompt,
          attachments: [],
          providerId: sessionModelSelection.value?.effective?.providerId ?? null,
          model: sessionModelSelection.value?.effective?.model ?? null,
        })
      }
      catch (error) {
        console.warn('failed to send seed prompt', error)
      }
    }

    activeSurface.value = 'main'
    activeSessionId.value = createdDetail.id
    showBuiltinWelcome.value = false
    workspaceOpen.value = false
    return createdDetail.id
  }

  async function renameSession(sessionId: string, title: string) {
    const normalizedTitle = title.trim()
    if (!normalizedTitle)
      return null

    const result = await provider.renameSession?.({
      sessionId,
      title: normalizedTitle,
    })

    if (!result)
      return null

    return updateSessionDetail(result.session)
  }

  async function deleteSession(assistantId: string, sessionId: string) {
    await getOpencodeDesktopApi().deleteSession(sessionId)
    mutateAssistant(assistantId, assistant => ({
      ...assistant,
      sessions: assistant.sessions.filter(session => session.id !== sessionId),
    }))
    sessionMap.value = Object.fromEntries(
      Object.entries(sessionMap.value).filter(([key]) => key !== sessionId),
    )
    const nextSessionId = activeSessionId.value === sessionId
      ? getFirstAvailableSessionId(assistantId)
      : activeSessionId.value
    return refreshBootstrap(nextSessionId)
  }

  async function deleteAssistant(assistantId: string) {
    const removedSessionIds = new Set(getAssistantSessionIds(assistantId))
    const assistant = findAssistantById(assistantId)
    if (!assistant)
      return null

    const isGroupTemplate = !!assistant.groupParticipantAssistantIds?.length || !!assistant.groupCollaborationMode
    if (isGroupTemplate)
      await getOpencodeDesktopApi().deleteGroupRoom(assistantId)
    else
      await getOpencodeDesktopApi().deleteAssistant(assistantId)
    invitedAssistants.value = invitedAssistants.value.filter(id => id !== assistantId)
    if (editingAssistantId.value === assistantId)
      closeNewAssistant()
    sessionMap.value = Object.fromEntries(
      Object.entries(sessionMap.value).filter(([key]) => !removedSessionIds.has(key)),
    )
    return refreshBootstrap(removedSessionIds.has(activeSessionId.value) ? '' : activeSessionId.value)
  }

  async function saveSessionModelOverride(selection: { providerId: string, model: string }) {
    if (!activeSessionId.value)
      return null

    const nextSelection = await getOpencodeDesktopApi().saveSessionModelOverride({
      sessionID: activeSessionId.value,
      providerId: selection.providerId,
      model: selection.model,
    }) as StudioSessionModelSelectionState
    sessionModelSelection.value = nextSelection
    return nextSelection
  }

  async function clearSessionModelOverride() {
    if (!activeSessionId.value)
      return null

    const nextSelection = await getOpencodeDesktopApi().clearSessionModelOverride(activeSessionId.value) as StudioSessionModelSelectionState
    sessionModelSelection.value = nextSelection
    return nextSelection
  }

  function selectArtifact(artifactId: string) {
    if (!activeSessionId.value)
      return
    mutateSessionDetail(activeSessionId.value, session => ({
      ...session,
      selectedArtifactId: artifactId,
    }))
  }

  function isCardPending(cardId: string) {
    return pendingMutation.value?.sessionId === activeSessionId.value && pendingMutation.value?.cardId === cardId
  }

  function isActionPending(actionId: string) {
    return pendingMutation.value?.sessionId === activeSessionId.value && pendingMutation.value?.actionId === actionId
  }

  async function sendMessage(payload: Omit<AIStudioSendMessagePayload, 'sessionId'>) {
    if (!activeSessionId.value)
      return null

    const sessionId = activeSessionId.value
    const optimisticMessage: StudioMessage = {
      id: `user-optimistic-${Date.now()}`,
      role: 'user',
      content: payload.content.trim(),
      attachments: payload.attachments ? [...payload.attachments] : undefined,
      time: '刚刚',
    }

    pendingMutation.value = {
      sessionId,
      kind: 'message',
    }
    errorMessage.value = ''

    if (sessionMap.value[sessionId]) {
      mutateSessionDetail(sessionId, session => ({
        ...session,
        messages: [...session.messages, optimisticMessage],
      }))
      touchSession(sessionId)
      isAiTyping.value = true
    }

    try {
      await provider.sendMessage({
        sessionId,
        ...payload,
        providerId: sessionModelSelection.value?.effective?.providerId ?? null,
        model: sessionModelSelection.value?.effective?.model ?? null,
      })
      return sessionMap.value[sessionId] || null
    }
    catch (error) {
      if (sessionMap.value[sessionId]) {
        mutateSessionDetail(sessionId, session => ({
          ...session,
          messages: session.messages.filter(message => message.id !== optimisticMessage.id),
        }))
      }
      isAiTyping.value = false
      errorMessage.value = error instanceof Error ? error.message : 'AI Studio 交互提交失败'
      throw error
    }
    finally {
      pendingMutation.value = null
    }
  }

  async function abortSession() {
    if (!activeSessionId.value || !provider.abortSession)
      return null

    const sessionId = activeSessionId.value

    try {
      await provider.abortSession(sessionId)
      return sessionMap.value[sessionId] || null
    }
    finally {
      isAiTyping.value = false
      pendingMutation.value = null
      void loadSessionDetail(sessionId, { force: true, includeWorkspace: false })
    }
  }

  async function submitChoiceForm(payload: Omit<AIStudioChoiceSubmissionPayload, 'sessionId'>) {
    if (!activeSessionId.value)
      return null
    return runMutation(
      {
        sessionId: activeSessionId.value,
        kind: 'choice',
        cardId: payload.cardId,
      },
      () => provider.submitChoiceForm({
        sessionId: activeSessionId.value,
        ...payload,
      }),
    )
  }

  async function submitParamForm(payload: Omit<AIStudioParamSubmissionPayload, 'sessionId'>) {
    if (!activeSessionId.value)
      return null
    return runMutation(
      {
        sessionId: activeSessionId.value,
        kind: 'param',
        cardId: payload.cardId,
      },
      () => provider.submitParamForm({
        sessionId: activeSessionId.value,
        ...payload,
      }),
    )
  }

  async function submitCardAction(payload: Omit<AIStudioCardActionPayload, 'sessionId'>) {
    if (!activeSessionId.value)
      return null
    return runMutation(
      {
        sessionId: activeSessionId.value,
        kind: 'action',
        cardId: payload.cardId,
        actionId: payload.actionId,
      },
      () => provider.submitCardAction({
        sessionId: activeSessionId.value,
        ...payload,
      }),
    )
  }

  function extractRuntimeEventSessionId(event: { type: string; properties: Record<string, unknown> }) {
    if (event.type === 'session.idle' || event.type === 'session.status' || event.type === 'session.compacted' || event.type === 'session.error') {
      return event.properties.sessionID as string | undefined
    }

    if (event.type === 'session.updated' || event.type === 'session.created' || event.type === 'session.deleted') {
      return (event.properties.info as { id?: string } | undefined)?.id
    }

    if (event.type === 'message.updated') {
      return (event.properties.info as { sessionID?: string } | undefined)?.sessionID
    }

    if (event.type === 'message.removed' || event.type === 'message.part.delta' || event.type === 'message.part.removed') {
      return event.properties.sessionID as string | undefined
    }

    if (event.type === 'message.part.updated') {
      return (event.properties.part as { sessionID?: string } | undefined)?.sessionID
    }

    return undefined
  }

  async function flushRuntimeSessionRefresh(sessionId: string) {
    if (sessionId !== activeSessionId.value)
      return

    if (runtimeRefreshInFlight) {
      queuedRuntimeRefreshSessionId = sessionId
      return
    }

    runtimeRefreshInFlight = true

    try {
      await loadSessionDetail(sessionId, { force: true, includeWorkspace: false })
    }
    finally {
      runtimeRefreshInFlight = false

      if (queuedRuntimeRefreshSessionId && queuedRuntimeRefreshSessionId === activeSessionId.value) {
        const nextSessionId = queuedRuntimeRefreshSessionId
        queuedRuntimeRefreshSessionId = null
        void flushRuntimeSessionRefresh(nextSessionId)
      }
    }
  }

  function scheduleRuntimeSessionRefresh(sessionId: string, immediate = false) {
    if (sessionId !== activeSessionId.value)
      return

    if (immediate) {
      if (runtimeRefreshTimer) {
        clearTimeout(runtimeRefreshTimer)
        runtimeRefreshTimer = null
      }
      void flushRuntimeSessionRefresh(sessionId)
      return
    }

    queuedRuntimeRefreshSessionId = sessionId
    if (runtimeRefreshTimer)
      return

    runtimeRefreshTimer = setTimeout(() => {
      runtimeRefreshTimer = null
      const nextSessionId = queuedRuntimeRefreshSessionId
      queuedRuntimeRefreshSessionId = null
      if (nextSessionId) {
        void flushRuntimeSessionRefresh(nextSessionId)
      }
    }, 120)
  }

  function setFocusedAssistant(assistantId: string | null) {
    focusedAssistantId.value = assistantId
  }

  function signalBuiltinClicked() {
    showBuiltinWelcome.value = true
    activeSessionId.value = INITIAL_SESSION_ID
  }

  async function startBuiltinChat(topic: string): Promise<string | null> {
    const builtinGroup = assistantGroups.value.find(group => group.id === 'builtin')
    const builtinAssistant = builtinGroup?.assistants[0]

    if (!builtinAssistant) {
      console.error('Builtin assistant not found')
      return null
    }

    if (!provider.createSession) {
      console.error('createSession not supported by provider')
      return null
    }

    try {
      const sessionId = await createSessionForAssistant(builtinAssistant.id, {
        seedPrompt: topic,
      })
      if (!sessionId)
        return null
      setFocusedAssistant(builtinAssistant.id)
      showBuiltinWelcome.value = false
      return sessionId
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '启动会话失败'
      return null
    }
  }

  // Subscribe to opencode runtime events for real-time session updates.
  // This is the primary mechanism for receiving AI responses and message updates —
  // sendMessage only triggers async processing; results arrive via this event stream.
  if (typeof window !== 'undefined' && 'opencodeApi' in window) {
    getOpencodeDesktopApi().onRuntimeEvent((rawEvent: unknown) => {
      const event = rawEvent as { type: string; properties: Record<string, unknown> }
      if (!event?.type) return

      const eventSessionId = extractRuntimeEventSessionId(event)
      if (!eventSessionId || eventSessionId !== activeSessionId.value) return

      if (event.type === 'session.status') {
        const status = event.properties.status as { type: string } | undefined
        if (status?.type === 'busy') isAiTyping.value = true
      }
      else if (event.type === 'session.error') {
        isAiTyping.value = false
        const runtimeError = event.properties.error as { data?: { message?: string } } | undefined
        errorMessage.value = runtimeError?.data?.message || 'AI Studio 运行失败'
        scheduleRuntimeSessionRefresh(eventSessionId, true)
      }
      else if (event.type === 'session.idle') {
        isAiTyping.value = false
        scheduleRuntimeSessionRefresh(eventSessionId, true)
      }
      else if (
        event.type === 'message.updated'
        || event.type === 'message.removed'
        || event.type === 'message.part.updated'
        || event.type === 'message.part.delta'
        || event.type === 'message.part.removed'
        || event.type === 'session.updated'
        || event.type === 'session.created'
      ) {
        scheduleRuntimeSessionRefresh(eventSessionId)
      }
    })
  }

  return {
    activeSurface,
    activeSession,
    activeSessionLoading,
    activeSessionId,
    assistantModalMode,
    assistantTemplateKind,
    assistantGroups,
    abortSession,
    closeInviteAssistant,
    closeNewAssistant,
    createAssistant,
    deleteAssistant,
    deleteSession,
    clearSessionModelOverride,
    editingAssistant,
    ensureInitialized,
    errorMessage,
    initialized,
    inviteAssistants,
    invitedAssistants,
    isActionPending,
    isActiveSessionPending,
    isAiTyping,
    isCardPending,
    loading,
    newSessionParticipantCandidates,
    openInviteAssistant,
    openEditAssistant,
    openNewAssistant,
    openNewGroupTemplate,
    openSurface,
    pendingMutation,
    renameSession,
    saveSessionModelOverride,
    selectArtifact,
    sendMessage,
    sessionMap,
    sessionModelSelection,
    setActiveSession,
    setFocusedAssistant,
    setWorkspaceOpen,
    focusedAssistantId,
    showBuiltinWelcome,
    showInviteAssistant,
    showNewAssistant,
    signalBuiltinClicked,
    startBuiltinChat,
    submitCardAction,
    submitChoiceForm,
    submitParamForm,
    toggleWorkspace,
    updateAssistant,
    createSessionForAssistant,
    workspaceOpen,
  }
})
