import { describe, expect, it } from 'vitest'

import { toStudioAssistantGroups, toStudioSessionDetail } from './adapter'

describe('toStudioAssistantGroups', () => {
  it('exposes persisted workspace paths for assistants and group rooms', () => {
    const groups = toStudioAssistantGroups(
      [
        {
          id: 'assistant-1',
          name: '代码助手',
          description: null,
          avatar: null,
          color: null,
          systemPrompt: null,
          defaultModel: null,
          skillIds: [],
          toolIds: [],
          toolPolicy: 'allow_assigned',
          workspacePath: 'D:/Workspaces/assistants/code',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        } as any,
      ],
      [
        {
          id: 'group-1',
          name: '评审群聊',
          description: null,
          memberAssistantIds: ['assistant-1'],
          coordinatorPrompt: null,
          collaborationMode: 'auto',
          workspacePath: 'D:/Workspaces/groups/review',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        } as any,
      ],
      new Map(),
      new Map(),
      [],
    )

    expect(groups[0]?.assistants[0]?.workspacePath).toBe('D:/Workspaces/assistants/code')
    expect(groups[1]?.assistants[0]?.workspacePath).toBe('D:/Workspaces/groups/review')
  })

  it('uses the assigned workspace path and scanned files in session detail', () => {
    const detail = toStudioSessionDetail(
      {
        id: 'session-1',
        slug: 'quiet-harbor',
        projectID: 'project-1',
        directory: 'D:/Runtime/Cwd',
        title: 'Workspace Test',
        version: '1.2.27',
        time: { created: 1, updated: 2 },
      } as any,
      [],
      { type: 'idle' },
      'Code Assistant',
      'C',
      undefined,
      {
        workspacePath: 'D:/Workspaces/assistants/code',
        workspaceFiles: [
          { id: 'file-1', name: 'summary.md', type: 'file', indent: 0 },
        ],
        artifacts: [
          { id: 'artifact-1', name: 'summary.md', summary: 'Generated summary', tag: '工作区文件', tagTone: 'neutral' },
        ],
      },
    )

    expect(detail.workspacePath).toBe('D:/Workspaces/assistants/code')
    expect(detail.workspaceFiles).toEqual([
      { id: 'file-1', name: 'summary.md', type: 'file', indent: 0 },
    ])
    expect(detail.artifacts).toEqual([
      { id: 'artifact-1', name: 'summary.md', summary: 'Generated summary', tag: '工作区文件', tagTone: 'neutral' },
    ])
  })

  it('keeps running tool calls active when session is idle without explicit error', () => {
    const detail = toStudioSessionDetail(
      {
        id: 'session-running-stale',
        slug: 'stale-run',
        projectID: 'project-1',
        directory: 'C:/Users/test',
        title: 'Stale Tool State',
        version: '1.0.0',
        time: { created: 1, updated: 2 },
      } as any,
      [
        {
          info: {
            id: 'assistant-msg-1',
            sessionID: 'session-running-stale',
            role: 'assistant',
            time: { created: Date.now() - 1000 },
            parentID: 'user-msg-1',
            modelID: 'test-model',
            providerID: 'test-provider',
            mode: 'default',
            agent: 'assistant-direct-assistant-1',
            path: { cwd: 'C:/Users/test', root: 'C:/Users/test' },
            cost: 0,
          },
          parts: [
            {
              id: 'tool-1',
              sessionID: 'session-running-stale',
              messageID: 'assistant-msg-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'glob',
              state: {
                status: 'running',
                input: { pattern: '**/*mcp*' },
                time: { start: Date.now() - 1000 },
              },
            },
          ],
        },
      ] as any,
      { type: 'idle' },
      'Test Assistant',
      'T',
    )

    const toolCard = detail.chatCards.find(card => card.type === 'tool-call-list')
    expect(toolCard && toolCard.type === 'tool-call-list' ? toolCard.calls[0]?.status : undefined).toBe('running')
    expect(toolCard && toolCard.type === 'tool-call-list' ? toolCard.calls[0]?.result : undefined).toBeUndefined()
    expect(detail.headerTag).toBe('空闲')
  })

  it('renders all child session assistant texts as participant bubbles before falling back to task_result', () => {
    const detail = toStudioSessionDetail(
      {
        id: 'group-session-1',
        slug: 'group-session-1',
        projectID: 'project-1',
        directory: 'D:/Workspaces/group',
        title: '群聊会话',
        version: '1.0.0',
        time: { created: 1, updated: 2 },
      } as any,
      [
        {
          info: {
            id: 'assistant-msg-1',
            sessionID: 'group-session-1',
            role: 'assistant',
            time: { created: 1_000 },
            parentID: 'user-msg-1',
            modelID: 'test-model',
            providerID: 'test-provider',
            mode: 'default',
            agent: 'room-coordinator-group-1',
            path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
            cost: 0,
          },
          parts: [
            {
              id: 'tool-1',
              sessionID: 'group-session-1',
              messageID: 'assistant-msg-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'task',
              state: {
                status: 'completed',
                input: {
                  description: '查询北京天气',
                  prompt: '查询北京天气',
                  subagent_type: 'assistant-worker-weather-1',
                },
                title: '查询北京天气',
                metadata: {
                  sessionId: 'child-session-1',
                },
                output: [
                  'task_id: child-session-1',
                  '',
                  '<task_result>',
                  '这是 task_result 兜底文本',
                  '</task_result>',
                ].join('\n'),
                time: { start: 1_000, end: 2_000 },
              },
            },
            {
              id: 'text-1',
              sessionID: 'group-session-1',
              messageID: 'assistant-msg-1',
              type: 'text',
              text: '我来帮你查询北京天气。',
            },
          ],
        },
      ] as any,
      { type: 'idle' },
      '群聊协调者',
      '群',
      {
        mode: 'group',
        participantAssistantIds: ['weather-1'],
        participantAssistants: [
          { id: 'weather-1', name: '天气查询助手', badge: '天' },
        ],
      },
      undefined,
      [
        {
          session: {
            id: 'child-session-1',
            slug: 'child-session-1',
            projectID: 'project-1',
            directory: 'D:/Workspaces/group',
            parentID: 'group-session-1',
            title: '查询北京天气',
            version: '1.0.0',
            time: { created: 1_100, updated: 2_100 },
          },
          status: { type: 'idle' },
          messages: [
            {
              info: {
                id: 'child-user-1',
                sessionID: 'child-session-1',
                role: 'user',
                time: { created: 1_100 },
                agent: 'room-coordinator-group-1',
                model: { providerID: 'test-provider', modelID: 'test-model' },
              },
              parts: [
                {
                  id: 'child-user-text-1',
                  sessionID: 'child-session-1',
                  messageID: 'child-user-1',
                  type: 'text',
                  text: '查询北京天气',
                },
              ],
            },
            {
              info: {
                id: 'child-assistant-1',
                sessionID: 'child-session-1',
                role: 'assistant',
                time: { created: 1_200, completed: 2_100 },
                parentID: 'child-user-1',
                modelID: 'test-model',
                providerID: 'test-provider',
                mode: 'default',
                agent: 'assistant-worker-weather-1',
                path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
                cost: 0,
              },
              parts: [
                {
                  id: 'child-text-1',
                  sessionID: 'child-session-1',
                  messageID: 'child-assistant-1',
                  type: 'text',
                  text: '现在让我获取未来几天的天气预报摘要：',
                },
              ],
            },
            {
              info: {
                id: 'child-assistant-2',
                sessionID: 'child-session-1',
                role: 'assistant',
                time: { created: 1_500, completed: 2_100 },
                parentID: 'child-user-1',
                modelID: 'test-model',
                providerID: 'test-provider',
                mode: 'default',
                agent: 'assistant-worker-weather-1',
                path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
                cost: 0,
              },
              parts: [
                {
                  id: 'child-text-2',
                  sessionID: 'child-session-1',
                  messageID: 'child-assistant-2',
                  type: 'text',
                  text: '北京今天晴，15 到 17 度。',
                },
              ],
            },
          ],
        },
      ] as any,
    )

    const participantTexts = detail.chatCards
      .filter((card): card is Extract<typeof detail.chatCards[number], { type: 'text' }> => card.type === 'text')
      .filter(card => card.assistantId === 'weather-1')

    expect(participantTexts.map(card => card.content)).toEqual([
      '现在让我获取未来几天的天气预报摘要：',
      '北京今天晴，15 到 17 度。',
    ])
    expect(detail.chatCards.some(card => card.type === 'text' && card.content.includes('这是 task_result 兜底文本'))).toBe(false)
    expect(detail.childSessionIds).toEqual(['child-session-1'])
  })

  it('renders child session tool calls as participant tool cards', () => {
    const detail = toStudioSessionDetail(
      {
        id: 'group-session-2',
        slug: 'group-session-2',
        projectID: 'project-1',
        directory: 'D:/Workspaces/group',
        title: '群聊会话',
        version: '1.0.0',
        time: { created: 1, updated: 2 },
      } as any,
      [
        {
          info: {
            id: 'assistant-msg-2',
            sessionID: 'group-session-2',
            role: 'assistant',
            time: { created: 1_000 },
            parentID: 'user-msg-2',
            modelID: 'test-model',
            providerID: 'test-provider',
            mode: 'default',
            agent: 'room-coordinator-group-2',
            path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
            cost: 0,
          },
          parts: [
            {
              id: 'tool-2',
              sessionID: 'group-session-2',
              messageID: 'assistant-msg-2',
              type: 'tool',
              callID: 'call-2',
              tool: 'task',
              state: {
                status: 'completed',
                input: {
                  description: '查询合肥天气',
                  prompt: '查询合肥天气',
                  subagent_type: 'assistant-worker-weather-2',
                },
                title: '查询合肥天气',
                metadata: {
                  sessionId: 'child-session-2',
                },
                output: [
                  'task_id: child-session-2',
                  '',
                  '<task_result>',
                  '合肥今天多云。',
                  '</task_result>',
                ].join('\n'),
                time: { start: 1_000, end: 2_000 },
              },
            },
          ],
        },
      ] as any,
      { type: 'idle' },
      '群聊协调者',
      '群',
      {
        mode: 'group',
        participantAssistantIds: ['weather-2'],
        participantAssistants: [
          { id: 'weather-2', name: '天气查询助手', badge: '天' },
        ],
      },
      undefined,
      [
        {
          session: {
            id: 'child-session-2',
            slug: 'child-session-2',
            projectID: 'project-1',
            directory: 'D:/Workspaces/group',
            parentID: 'group-session-2',
            title: '查询合肥天气',
            version: '1.0.0',
            time: { created: 1_100, updated: 2_100 },
          },
          status: { type: 'busy' },
          messages: [
            {
              info: {
                id: 'child-assistant-3',
                sessionID: 'child-session-2',
                role: 'assistant',
                time: { created: 1_200, completed: 2_100 },
                parentID: 'child-user-2',
                modelID: 'test-model',
                providerID: 'test-provider',
                mode: 'default',
                agent: 'assistant-worker-weather-2',
                path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
                cost: 0,
              },
              parts: [
                {
                  id: 'child-tool-part-1',
                  sessionID: 'child-session-2',
                  messageID: 'child-assistant-3',
                  type: 'tool',
                  callID: 'weather-call-1',
                  tool: 'web_search',
                  state: {
                    status: 'completed',
                    input: { q: '合肥天气' },
                    title: '查询合肥天气',
                    metadata: {},
                    output: '晴，15 到 23 度。',
                    time: { start: 1_210, end: 1_800 },
                  },
                },
                {
                  id: 'child-text-3',
                  sessionID: 'child-session-2',
                  messageID: 'child-assistant-3',
                  type: 'text',
                  text: '合肥今天多云，稍后转晴。',
                },
              ],
            },
          ],
        },
      ] as any,
    )

    const participantToolCard = detail.chatCards.find((card): card is Extract<typeof detail.chatCards[number], { type: 'tool-call-list' }> =>
      card.type === 'tool-call-list' && card.assistantId === 'weather-2',
    )

    expect(participantToolCard?.calls).toEqual([
      {
        name: 'web_search',
        arg: '{\n  "q": "合肥天气"\n}',
        status: 'done',
        result: '晴，15 到 23 度。',
        duration: '0.6s',
      },
    ])
  })

  it('keeps coordinator text before delegated child session cards when text appears before task parts', () => {
    const detail = toStudioSessionDetail(
      {
        id: 'group-session-3',
        slug: 'group-session-3',
        projectID: 'project-1',
        directory: 'D:/Workspaces/group',
        title: '群聊会话',
        version: '1.0.0',
        time: { created: 1, updated: 2 },
      } as any,
      [
        {
          info: {
            id: 'assistant-msg-3',
            sessionID: 'group-session-3',
            role: 'assistant',
            time: { created: 1_000 },
            parentID: 'user-msg-3',
            modelID: 'test-model',
            providerID: 'test-provider',
            mode: 'default',
            agent: 'room-coordinator-group-3',
            path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
            cost: 0,
          },
          parts: [
            {
              id: 'coordinator-text-1',
              sessionID: 'group-session-3',
              messageID: 'assistant-msg-3',
              type: 'text',
              text: '我来帮您查询东京的天气。让我调用天气查询助手来获取最新信息。',
            },
            {
              id: 'coordinator-task-1',
              sessionID: 'group-session-3',
              messageID: 'assistant-msg-3',
              type: 'tool',
              callID: 'call-3',
              tool: 'task',
              state: {
                status: 'completed',
                input: {
                  description: '查询东京天气',
                  prompt: '查询东京天气',
                  subagent_type: 'assistant-worker-weather-3',
                },
                title: '查询东京天气',
                metadata: {
                  sessionId: 'child-session-3',
                },
                output: [
                  'task_id: child-session-3',
                  '',
                  '<task_result>',
                  '东京今天晴。',
                  '</task_result>',
                ].join('\n'),
                time: { start: 1_020, end: 2_000 },
              },
            },
          ],
        },
      ] as any,
      { type: 'idle' },
      '文件协作',
      '文',
      {
        mode: 'group',
        participantAssistantIds: ['weather-3'],
        participantAssistants: [
          { id: 'weather-3', name: '天气查询助手', badge: '天' },
        ],
      },
      undefined,
      [
        {
          session: {
            id: 'child-session-3',
            slug: 'child-session-3',
            projectID: 'project-1',
            directory: 'D:/Workspaces/group',
            parentID: 'group-session-3',
            title: '查询东京天气',
            version: '1.0.0',
            time: { created: 1_100, updated: 2_100 },
          },
          status: { type: 'idle' },
          messages: [
            {
              info: {
                id: 'child-assistant-4',
                sessionID: 'child-session-3',
                role: 'assistant',
                time: { created: 1_200, completed: 2_100 },
                parentID: 'child-user-3',
                modelID: 'test-model',
                providerID: 'test-provider',
                mode: 'default',
                agent: 'assistant-worker-weather-3',
                path: { cwd: 'D:/Workspaces/group', root: 'D:/Workspaces/group' },
                cost: 0,
              },
              parts: [
                {
                  id: 'child-text-4',
                  sessionID: 'child-session-3',
                  messageID: 'child-assistant-4',
                  type: 'text',
                  text: '我来查一下东京当前天气。',
                },
              ],
            },
          ],
        },
      ] as any,
    )

    const timeline = detail.chatCards.map(card => ({
      type: card.type,
      assistantId: card.assistantId,
      content: card.type === 'text' ? card.content : card.calls[0]?.name,
    }))

    expect(timeline).toEqual([
      {
        type: 'text',
        assistantId: undefined,
        content: '我来帮您查询东京的天气。让我调用天气查询助手来获取最新信息。',
      },
      {
        type: 'tool-call-list',
        assistantId: undefined,
        content: 'task',
      },
      {
        type: 'text',
        assistantId: 'weather-3',
        content: '我来查一下东京当前天气。',
      },
    ])
  })
})
