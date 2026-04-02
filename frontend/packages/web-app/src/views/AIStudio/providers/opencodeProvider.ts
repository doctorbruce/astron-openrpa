import type {
  AIStudioBootstrap,
  AIStudioCardActionPayload,
  AIStudioChoiceSubmissionPayload,
  AIStudioCreateSessionPayload,
  AIStudioParamSubmissionPayload,
  AIStudioProvider,
  AIStudioRenameSessionPayload,
  AIStudioSendMessagePayload,
  AIStudioSessionMutationResult,
} from '../contracts'
import type { StudioMessageAttachment } from '../types'

export type OpencodeDesktopApi = {
  getBootstrap: () => Promise<AIStudioBootstrap>
  getSession: (sessionId: string, options?: { includeWorkspace?: boolean }) => Promise<unknown>
  createSession: (payload: { title?: string | null; assistantId?: string | null; groupRoomId?: string | null; workspacePath?: string | null }) => Promise<{ id: string }>
  renameSession: (payload: { sessionId: string; title?: string | null }) => Promise<{ success: boolean }>
  deleteSession: (sessionId: string) => Promise<{ success: boolean }>
  sendMessage: (payload: {
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
  }) => Promise<{ success: boolean }>
  listAssistants: () => Promise<unknown[]>
  saveAssistant: (input: unknown) => Promise<unknown>
  deleteAssistant: (id: string) => Promise<unknown>
  listGroupRooms: () => Promise<unknown[]>
  saveGroupRoom: (input: unknown) => Promise<unknown>
  deleteGroupRoom: (id: string) => Promise<unknown>
  onRuntimeEvent: (listener: (event: unknown) => void) => () => void
}

function isElectron() {
  return typeof window !== 'undefined' && 'opencodeApi' in window
}

export function getOpencodeDesktopApi(): OpencodeDesktopApi {
  if (!isElectron()) {
    throw new Error('opencodeApi is not available outside Electron context')
  }
  return window.opencodeApi as OpencodeDesktopApi
}

async function fetchSessionDetail(
  sessionId: string,
  options?: { includeWorkspace?: boolean },
): Promise<import('../types').StudioSessionDetail> {
  const api = getOpencodeDesktopApi()
  const result = await api.getSession(sessionId, options)
  return result as import('../types').StudioSessionDetail
}

function toDesktopAttachment(attachment: StudioMessageAttachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    url: attachment.url,
  }
}

function unsupportedRuntimeMutation(name: string): never {
  throw new Error(`AI Studio runtime does not support ${name} yet`)
}

function normalizeSkillNames(skills?: string[]) {
  return [...new Set((skills || []).map(skill => skill.trim()).filter(Boolean))]
}

function buildSkillReminder(skills?: string[]) {
  const selectedSkills = normalizeSkillNames(skills)
  if (selectedSkills.length === 0)
    return ''

  const skillList = selectedSkills.map(skill => `"${skill}"`).join(', ')
  return [
    '<system-reminder>',
    `The user wants you to use the following skill${selectedSkills.length > 1 ? 's' : ''} for this request if relevant: ${skillList}.`,
    'If appropriate, load the relevant skill with the skill tool before continuing.',
    '</system-reminder>',
    '',
  ].join('\n')
}

export const opencodeAIStudioProvider: AIStudioProvider = {
  getBootstrap: async (): Promise<AIStudioBootstrap> => {
    const api = getOpencodeDesktopApi()
    const result = await api.getBootstrap()
    return result as AIStudioBootstrap
  },

  getSessionDetail: async (sessionId: string, options?: { includeWorkspace?: boolean }) => {
    return fetchSessionDetail(sessionId, options)
  },

  sendMessage: async (payload: AIStudioSendMessagePayload): Promise<void> => {
    const api = getOpencodeDesktopApi()
    const skillReminder = buildSkillReminder(payload.skills)
    await api.sendMessage({
      sessionID: payload.sessionId,
      text: `${skillReminder}${payload.content}`.trim(),
      attachments: payload.attachments?.map(toDesktopAttachment),
    })
  },

  createSession: async (payload: AIStudioCreateSessionPayload): Promise<AIStudioSessionMutationResult> => {
    const api = getOpencodeDesktopApi()
    const created = await api.createSession({
      title: payload.title ?? null,
      assistantId: payload.assistantId ?? null,
      groupRoomId: payload.agentId ?? null,
      workspacePath: payload.workspacePath ?? null,
    })
    const session = await fetchSessionDetail(created.id, { includeWorkspace: false })
    return { session }
  },

  renameSession: async (payload: AIStudioRenameSessionPayload): Promise<AIStudioSessionMutationResult> => {
    const api = getOpencodeDesktopApi()
    await api.renameSession({
      sessionId: payload.sessionId,
      title: payload.title ?? null,
    })
    const session = await fetchSessionDetail(payload.sessionId, { includeWorkspace: false })
    return { session }
  },

  submitChoiceForm: async (_payload: AIStudioChoiceSubmissionPayload): Promise<AIStudioSessionMutationResult> => {
    return unsupportedRuntimeMutation('choice-form submission')
  },

  submitParamForm: async (_payload: AIStudioParamSubmissionPayload): Promise<AIStudioSessionMutationResult> => {
    return unsupportedRuntimeMutation('param-form submission')
  },

  submitCardAction: async (_payload: AIStudioCardActionPayload): Promise<AIStudioSessionMutationResult> => {
    return unsupportedRuntimeMutation('card action')
  },
}
