import { describe, expect, it } from 'vitest'

import { resolveSessionMessageContext } from './workspace-context'

describe('resolveSessionMessageContext', () => {
  it('adds a non-execution guard for assistant sessions', () => {
    const context = resolveSessionMessageContext(
      'session-1',
      [
        {
          id: 'assistant-1',
          name: 'Test Assistant',
          description: null,
          avatar: null,
          color: null,
          systemPrompt: null,
          defaultModel: null,
          skillIds: [],
          toolIds: [],
          toolPolicy: 'allow_assigned',
          workspacePath: 'D:/Workspaces/assistants/test',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      [],
      [
        {
          assistantId: 'assistant-1',
          runtimeSessionId: 'session-1',
          title: 'Session',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      [],
    )

    expect(context.agent).toBe('assistant-direct-assistant-1')
    expect(context.system).toContain('Workspace root: D:/Workspaces/assistants/test')
    expect(context.system).toContain('answer conversationally first')
    expect(context.system).toContain('Do not run bash, MCP tools, skill tools')
  })

  it('returns the interaction guard even when the session is not bound', () => {
    const context = resolveSessionMessageContext('session-x', [], [], [], [])

    expect(context.agent).toBeUndefined()
    expect(context.system).toContain('If the request is ambiguous, ask one short clarifying question')
  })
})
