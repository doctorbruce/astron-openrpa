import type {
  AssistantRecord,
  AssistantSessionRecord,
  GroupRoomRecord,
  GroupRoomSessionRecord,
} from '../../shared/assistants'
import type { DesktopMcpServerStatus } from '../../shared/settings'

export type SessionMessageContext = {
  agent?: string | null
  system?: string | null
}

export type SessionWorkspaceContext = {
  workspacePath?: string | null
}

type DesktopMcpServerSummary = {
  name: string
  enabled: boolean
}

export function buildAssistantDirectAgentName(assistantId: string) {
  return `assistant-direct-${assistantId}`
}

export function buildAssistantWorkerAgentName(assistantId: string) {
  return `assistant-worker-${assistantId}`
}

export function buildRoomCoordinatorAgentName(roomId: string) {
  return `room-coordinator-${roomId}`
}

export function buildAssistantWorkspacePrompt(assistant: Pick<AssistantRecord, 'name' | 'workspacePath'>) {
  return buildWorkspaceInstructions({
    workspacePath: assistant.workspacePath,
    ownerName: assistant.name,
    kind: 'assistant',
  })
}

export function buildGroupWorkspacePrompt(room: Pick<GroupRoomRecord, 'name' | 'workspacePath'>) {
  return buildWorkspaceInstructions({
    workspacePath: room.workspacePath,
    ownerName: room.name,
    kind: 'group',
  })
}

export function appendPromptSection(basePrompt: string | null | undefined, section: string | null) {
  const normalizedBase = typeof basePrompt === 'string' && basePrompt.trim() ? basePrompt.trim() : ''
  const normalizedSection = typeof section === 'string' && section.trim() ? section.trim() : ''

  if (!normalizedBase) {
    return normalizedSection || undefined
  }

  if (!normalizedSection) {
    return normalizedBase
  }

  return `${normalizedBase}\n\n${normalizedSection}`
}

export function resolveSessionMessageContext(
  sessionID: string,
  assistants: AssistantRecord[],
  groupRooms: GroupRoomRecord[],
  assistantSessions: AssistantSessionRecord[],
  groupRoomSessions: GroupRoomSessionRecord[],
): SessionMessageContext {
  const interactionGuard = buildInteractionGuardPrompt()
  const groupSession = groupRoomSessions.find((session) => session.runtimeSessionId === sessionID)
  if (groupSession) {
    const room = groupRooms.find((item) => item.id === groupSession.groupRoomId)
    if (room) {
      return {
        agent: buildRoomCoordinatorAgentName(room.id),
        system: appendPromptSection(buildGroupWorkspacePrompt(room), interactionGuard) ?? null,
      }
    }
  }

  const assistantSession = assistantSessions.find((session) => session.runtimeSessionId === sessionID)
  if (assistantSession) {
    const assistant = assistants.find((item) => item.id === assistantSession.assistantId)
    if (assistant) {
      return {
        agent: buildAssistantDirectAgentName(assistant.id),
        system: appendPromptSection(buildAssistantWorkspacePrompt(assistant), interactionGuard) ?? null,
      }
    }
  }

  return {
    system: interactionGuard,
  }
}

export function resolveSessionWorkspaceContext(
  sessionID: string,
  assistants: AssistantRecord[],
  groupRooms: GroupRoomRecord[],
  assistantSessions: AssistantSessionRecord[],
  groupRoomSessions: GroupRoomSessionRecord[],
): SessionWorkspaceContext {
  const groupSession = groupRoomSessions.find((session) => session.runtimeSessionId === sessionID)
  if (groupSession) {
    const room = groupRooms.find((item) => item.id === groupSession.groupRoomId)
    return { workspacePath: room?.workspacePath ?? null }
  }

  const assistantSession = assistantSessions.find((session) => session.runtimeSessionId === sessionID)
  if (assistantSession) {
    const assistant = assistants.find((item) => item.id === assistantSession.assistantId)
    return { workspacePath: assistant?.workspacePath ?? null }
  }

  return {}
}

export function buildMcpAvailabilityPrompt(
  servers: DesktopMcpServerSummary[],
  statuses: Record<string, DesktopMcpServerStatus>,
) {
  if (!servers.length) {
    return [
      'Current MCP runtime snapshot: no MCP servers are configured.',
      'When the user asks what MCP services are available now, answer strictly from this snapshot.',
    ].join('\n')
  }

  const connected: string[] = []
  const disconnected: string[] = []
  const unavailable: string[] = []

  for (const server of servers) {
    const runtimeStatus = statuses[server.name]

    if (!server.enabled) {
      unavailable.push(`${server.name} (disabled)`)
      continue
    }

    if (!runtimeStatus) {
      disconnected.push(server.name)
      continue
    }

    if (runtimeStatus.status === 'connected') {
      connected.push(server.name)
      continue
    }

    if (runtimeStatus.status === 'disabled') {
      disconnected.push(server.name)
      continue
    }

    if (runtimeStatus.status === 'failed') {
      unavailable.push(`${server.name} (failed)`)
      continue
    }

    if (runtimeStatus.status === 'needs_auth') {
      unavailable.push(`${server.name} (needs auth)`)
      continue
    }

    unavailable.push(`${server.name} (needs client registration)`)
  }

  const lines = ['Current MCP runtime snapshot for this request (authoritative):']
  lines.push(`Connected MCP servers: ${connected.length ? connected.join(', ') : 'none'}`)
  lines.push(`Disconnected MCP servers: ${disconnected.length ? disconnected.join(', ') : 'none'}`)
  lines.push(`Unavailable MCP servers: ${unavailable.length ? unavailable.join(', ') : 'none'}`)
  lines.push('When the user asks which MCP services are available now, answer strictly from this snapshot.')
  lines.push('Do not claim that disconnected, failed, unauthenticated, or disabled MCP servers are currently available.')
  lines.push('Do not list individual MCP tool names for a disconnected or unavailable server.')
  return lines.join('\n')
}

export function buildGroupMentionPrompt(
  mentionedAssistantIds: string[],
  room: Pick<GroupRoomRecord, 'name' | 'memberAssistantIds'> | null,
  assistants: Pick<AssistantRecord, 'id' | 'name'>[],
) {
  if (!room || mentionedAssistantIds.length === 0) {
    return null
  }

  const roomMemberIds = new Set(room.memberAssistantIds)
  const assistantsById = new Map(assistants.map(assistant => [assistant.id, assistant]))
  const mentionedMembers = [...new Set(mentionedAssistantIds)]
    .filter(id => roomMemberIds.has(id))
    .map((id) => {
      const assistant = assistantsById.get(id)
      if (!assistant) {
        return null
      }

      return {
        name: assistant.name,
        workerAgent: buildAssistantWorkerAgentName(id),
      }
    })
    .filter((value): value is { name: string, workerAgent: string } => Boolean(value))

  if (mentionedMembers.length === 0) {
    return null
  }

  const lines = [
    `The user explicitly mentioned these room members in ${room.name}:`,
  ]

  for (const member of mentionedMembers) {
    lines.push(`- ${member.name} via subagent ${member.workerAgent}`)
  }

  lines.push('Treat an explicit @mention as a routing instruction, not a weak preference.')
  lines.push('When one or more members are explicitly mentioned, you should delegate to the mentioned member first before answering on your own, unless delegation is impossible.')
  lines.push('For direct checks like greetings, availability, or requests addressed to a specific mentioned member, let that mentioned member answer first through the task tool.')
  lines.push('Do not answer in place of an explicitly mentioned member unless the delegation fails or the user is asking for room-level coordination instead.')
  lines.push('When using the task tool, prefer the corresponding subagent types listed above.')

  return lines.join('\n')
}

function buildWorkspaceInstructions(input: {
  workspacePath?: string
  ownerName: string
  kind: 'assistant' | 'group'
}) {
  const workspacePath = typeof input.workspacePath === 'string' && input.workspacePath.trim()
    ? input.workspacePath.trim()
    : null

  if (!workspacePath) {
    return null
  }

  const lines = [
    `Workspace root: ${workspacePath}`,
    'This is a soft application-level workspace constraint, not an enforced runtime cwd.',
  ]

  if (input.kind === 'group') {
    lines.push(`Use this workspace root for shared room artifacts and coordination outputs for ${input.ownerName}.`)
  }
  else {
    lines.push(`Treat this workspace as the primary working area for ${input.ownerName}.`)
  }

  lines.push('Prefer reading, writing, and creating files only under this workspace root.')
  lines.push('When you reference files or run tools, use explicit absolute paths under this workspace root whenever possible.')
  lines.push('If the user asks to work outside this workspace, explicitly acknowledge that you are leaving the assigned workspace before proceeding.')

  return lines.join('\n')
}

function buildInteractionGuardPrompt() {
  return [
    'When the user is asking about available capabilities, tools, MCP servers, skills, or how something works, answer conversationally first.',
    'Do not run bash, MCP tools, skill tools, or other execution tools just to demonstrate that they exist.',
    'Only invoke a tool when the user clearly asks you to execute, test, connect, inspect live external state, or make changes.',
    'If the request is ambiguous, ask one short clarifying question instead of running tools.',
  ].join('\n')
}
