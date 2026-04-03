import type { OpencodeMessageRecord, OpencodeSessionInfo, OpencodeSessionStatus } from '../../shared/sessions'
import type { DesktopMcpServerStatus } from '../../shared/settings'
import { buildPromptRequestBody, type CreateSessionInput, type SendMessageInput } from '../../shared/runtime'
import type { SidecarManager } from './sidecar'

export type RuntimeApi = {
  listSessions: () => Promise<OpencodeSessionInfo[]>
  listSessionChildren: (sessionID: string, directory?: string | null) => Promise<OpencodeSessionInfo[]>
  getSession: (sessionID: string, directory?: string | null) => Promise<OpencodeSessionInfo>
  getSessionMessages: (sessionID: string, directory?: string | null) => Promise<OpencodeMessageRecord[]>
  getSessionStatuses: () => Promise<Record<string, OpencodeSessionStatus>>
  getMcpStatus: () => Promise<Record<string, DesktopMcpServerStatus>>
  connectMcpServer: (name: string) => Promise<void>
  disconnectMcpServer: (name: string) => Promise<void>
  disposeGlobal: () => Promise<void>
  createSession: (input: CreateSessionInput) => Promise<OpencodeSessionInfo>
  deleteSession: (sessionID: string, directory?: string | null) => Promise<void>
  abortSession: (sessionID: string, directory?: string | null) => Promise<void>
  sendMessage: (input: SendMessageInput) => Promise<void>
  openEventStream: (signal: AbortSignal) => Promise<Response>
}

export function createRuntimeApi(runtime: Pick<SidecarManager, 'getConnection'>): RuntimeApi {
  return {
    listSessions: () => requestJson<OpencodeSessionInfo[]>('/session?roots=true'),
    listSessionChildren: (sessionID, directory) =>
      requestJson<OpencodeSessionInfo[]>(`/session/${encodeURIComponent(sessionID)}/children`, { directory }),
    getSession: (sessionID, directory) =>
      requestJson<OpencodeSessionInfo>(`/session/${encodeURIComponent(sessionID)}`, { directory }),
    getSessionMessages: (sessionID, directory) =>
      requestJson<OpencodeMessageRecord[]>(`/session/${encodeURIComponent(sessionID)}/message`, { directory }),
    getSessionStatuses: () => requestJson<Record<string, OpencodeSessionStatus>>('/session/status'),
    getMcpStatus: () => requestJson<Record<string, DesktopMcpServerStatus>>('/mcp'),
    connectMcpServer: async (name) => {
      await requestVoid(`/mcp/${encodeURIComponent(name)}/connect`, { method: 'POST' })
    },
    disconnectMcpServer: async (name) => {
      await requestVoid(`/mcp/${encodeURIComponent(name)}/disconnect`, { method: 'POST' })
    },
    disposeGlobal: async () => {
      await requestVoid('/global/dispose', { method: 'POST' })
    },
    createSession: (input) =>
      requestJson<OpencodeSessionInfo>('/session', {
        method: 'POST',
        directory: input.directory,
        body: { ...(input.title?.trim() ? { title: input.title.trim() } : {}) },
      }),
    deleteSession: async (sessionID, directory) => {
      await requestVoid(`/session/${encodeURIComponent(sessionID)}`, { method: 'DELETE', directory })
    },
    abortSession: async (sessionID, directory) => {
      await requestVoid(`/session/${encodeURIComponent(sessionID)}/abort`, { method: 'POST', directory })
    },
    sendMessage: async (input) => {
      await requestVoid(`/session/${encodeURIComponent(input.sessionID)}/prompt_async`, {
        method: 'POST',
        directory: input.directory,
        body: buildPromptRequestBody(input),
      })
    },
    openEventStream: async (signal) => {
      const connection = await runtime.getConnection()
      const url = new URL('/global/event', connection.baseUrl)
      const response = await fetch(url, {
        headers: {
          ...connection.headers,
          accept: 'text/event-stream',
          cache: 'no-cache',
        },
        method: 'GET',
        signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Bundled runtime event stream failed (${response.status} ${response.statusText})`)
      }

      return response
    },
  }

  async function requestJson<T>(pathname: string, init?: { method?: 'GET' | 'POST'; body?: unknown; directory?: string | null }) {
    const connection = await runtime.getConnection()
    const url = buildRuntimeUrl(connection.baseUrl, pathname, init?.directory)
    const response = await fetch(url, {
      headers: {
        ...connection.headers,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Bundled runtime request failed for ${url.pathname} (${response.status} ${response.statusText})`)
    }

    return (await response.json()) as T
  }

  async function requestVoid(pathname: string, init: { method: 'POST' | 'DELETE'; body?: unknown; directory?: string | null }) {
    const connection = await runtime.getConnection()
    const url = buildRuntimeUrl(connection.baseUrl, pathname, init.directory)
    const response = await fetch(url, {
      headers: {
        ...connection.headers,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      method: init.method,
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Bundled runtime request failed for ${url.pathname} (${response.status} ${response.statusText})`)
    }
  }

  function buildRuntimeUrl(baseUrl: string, pathname: string, directory?: string | null) {
    const url = new URL(pathname, baseUrl)
    const normalizedDirectory = typeof directory === 'string' && directory.trim() ? directory.trim() : ''
    if (normalizedDirectory) {
      url.searchParams.set('directory', normalizedDirectory)
    }
    return url
  }
}
