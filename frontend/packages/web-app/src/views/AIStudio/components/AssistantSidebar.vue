<script setup lang="ts">
import { MoreHorizontal, Plus, Search, Settings, Trash2, Users, Zap } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { StudioAssistant, StudioAssistantGroup, StudioSession } from '../types'

interface SidebarAssistantEntry extends StudioAssistant {
  groupId: string
  isCollaboration: boolean
}

interface VisibleSidebarAssistant {
  assistant: SidebarAssistantEntry
  sessions: StudioSession[]
  expanded: boolean
}

const props = defineProps<{
  groups: StudioAssistantGroup[]
  activeSessionId: string
  activeSurface?: 'main' | 'automation' | 'settings'
}>()

const emit = defineEmits<{
  (e: 'select-session', assistantId: string, sessionId: string): void
  (e: 'open-new-assistant'): void
  (e: 'open-new-group-template'): void
  (e: 'open-edit-assistant', assistantId: string): void
  (e: 'open-view-assistant', assistantId: string): void
  (e: 'open-new-session', assistantId: string): void
  (e: 'delete-assistant', assistantId: string): void
  (e: 'delete-session', assistantId: string, sessionId: string): void
  (e: 'open-automation'): void
  (e: 'open-settings'): void
  (e: 'click-assistant', assistantId: string): void
  (e: 'set-focused-assistant', assistantId: string | null): void
}>()

const searchQuery = ref('')
const focusedAssistantId = ref('')
const createMenuAnchorRef = ref<HTMLElement | null>(null)
const createMenuOpen = ref(false)

const unifiedAssistants = computed<SidebarAssistantEntry[]>(() =>
  props.groups
    .filter(group => group.id !== 'builtin')
    .flatMap(group =>
      group.assistants.map(assistant => ({
        ...assistant,
        groupId: group.id,
        isCollaboration: group.id === 'collaboration',
      })),
    ),
)

const builtinAssistant = computed<SidebarAssistantEntry | null>(() => {
  const builtinGroup = props.groups.find(group => group.id === 'builtin')
  if (!builtinGroup?.assistants.length)
    return null
  const assistant = builtinGroup.assistants[0]
  return {
    ...assistant,
    groupId: 'builtin',
    isCollaboration: false,
  }
})

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase())
const hasCollaborationAssistant = computed(() =>
  unifiedAssistants.value.some(assistant => assistant.isCollaboration),
)

const visibleAssistants = computed<VisibleSidebarAssistant[]>(() => {
  const query = normalizedSearchQuery.value
  const source = unifiedAssistants.value
  if (!query) {
    return source.map(assistant => ({
      assistant,
      sessions: assistant.sessions,
      expanded: assistant.id === focusedAssistantId.value && assistant.sessions.length > 0,
    }))
  }

  return source.flatMap((assistant) => {
    const assistantMatches = assistant.name.toLocaleLowerCase().includes(query)
    const matchedSessions = assistant.sessions.filter(session =>
      session.title.toLocaleLowerCase().includes(query),
    )

    if (!assistantMatches && matchedSessions.length === 0)
      return []

    return [{
      assistant,
      sessions: assistantMatches ? assistant.sessions : matchedSessions,
      expanded: true,
    }]
  })
})

function resolveAssistantIdBySession(sessionId: string) {
  const found = unifiedAssistants.value.find(assistant =>
    assistant.sessions.some(session => session.id === sessionId),
  )
  if (found)
    return found.id
  if (builtinAssistant.value?.sessions.some(session => session.id === sessionId))
    return builtinAssistant.value.id
  return undefined
}

function syncFocusedAssistant() {
  const builtinId = builtinAssistant.value?.id || ''
  const activeAssistantId = resolveAssistantIdBySession(props.activeSessionId)
  if (activeAssistantId) {
    focusedAssistantId.value = activeAssistantId
    return
  }

  const currentFocusedId = focusedAssistantId.value
  const hasFocusedRegular = unifiedAssistants.value.some(assistant => assistant.id === currentFocusedId)
  const hasFocusedBuiltin = builtinId && currentFocusedId === builtinId
  if (hasFocusedRegular || hasFocusedBuiltin)
    return

  if (builtinId) {
    focusedAssistantId.value = builtinId
    return
  }

  if (unifiedAssistants.value.length > 0) {
    const firstAssistantWithSessions = unifiedAssistants.value.find(assistant => assistant.sessions.length > 0)
    focusedAssistantId.value = firstAssistantWithSessions?.id || unifiedAssistants.value[0].id
  }
}

watch(() => props.activeSessionId, syncFocusedAssistant, { immediate: true })
watch(unifiedAssistants, syncFocusedAssistant)
watch(builtinAssistant, syncFocusedAssistant)

function focusAssistant(assistantId: string) {
  focusedAssistantId.value = assistantId
  emit('set-focused-assistant', assistantId)
  emit('click-assistant', assistantId)
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!createMenuOpen.value)
    return
  const anchor = createMenuAnchorRef.value
  if (!anchor)
    return
  if (anchor.contains(event.target as Node))
    return
  createMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <aside
    data-testid="ai-sidebar-shell"
    class="relative my-3 ml-3 mr-2.5 flex min-h-0 w-[clamp(276px,19.5vw,320px)] shrink-0 self-stretch flex-col overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_top_left,rgba(114,111,255,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.82)_0%,rgba(252,252,255,0.92)_24%,rgba(255,255,255,0.96)_100%)] shadow-[0_10px_24px_rgba(15,23,42,0.022)] backdrop-blur-[8px]"
    style="font-family: var(--font-sans-ui);"
  >
    <div ref="createMenuAnchorRef" class="relative px-4 pb-3 pt-4">
      <Button
        size="sm"
        data-testid="template-create-trigger"
        class="h-10 w-full justify-center gap-2 rounded-[15px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] px-4 text-[13px] font-semibold shadow-[0_8px_18px_rgba(114,111,255,0.18)] transition-colors hover:translate-y-0"
        @click="createMenuOpen = !createMenuOpen"
      >
        <Plus class="h-4 w-4" />
        <span>新建</span>
      </Button>
      <div v-if="createMenuOpen" class="absolute inset-x-4 top-[calc(100%-2px)] z-20 pt-2">
        <div class="w-full overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(248,249,255,0.95)_100%)] p-2 shadow-[0_14px_28px_rgba(15,23,42,0.10)]">
          <button
            data-testid="create-assistant-template"
            class="flex w-full appearance-none items-center gap-2 rounded-[14px] border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-[rgba(114,111,255,0.08)]"
            @click="createMenuOpen = false; emit('open-new-assistant')"
          >
            <Plus class="h-3.5 w-3.5 text-black/52" />
            <span class="text-[12px] leading-4 text-black/74">新建助手模板</span>
          </button>
          <button
            v-if="hasCollaborationAssistant"
            data-testid="create-group-template"
            class="mt-1 flex w-full appearance-none items-center gap-2 rounded-[14px] border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-[rgba(114,111,255,0.08)]"
            @click="createMenuOpen = false; emit('open-new-group-template')"
          >
            <Users class="h-3.5 w-3.5 text-[#5E5AE8]" />
            <span class="text-[12px] leading-4 text-black/74">新建群聊模板</span>
          </button>
        </div>
      </div>
    </div>

    <div class="relative mb-3 flex min-h-0 flex-1 flex-col">
      <div class="relative px-4 pt-3">
        <div class="relative">
          <Search class="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/28" />
          <Input
            v-model="searchQuery"
            data-testid="assistant-search-input"
            class="h-9 rounded-[14px] border-0 bg-white/62 pl-9 text-[13px] shadow-none ring-1 ring-[rgba(228,234,245,0.55)] focus:bg-white/82 focus:ring-[rgba(114,111,255,0.16)]"
            placeholder="搜索助手或会话..."
          />
        </div>
      </div>

      <ScrollArea class="relative min-h-0 flex-1 px-3 pb-4 pt-2">
        <div data-testid="assistant-list" class="space-y-1 rounded-[18px] px-1 py-1.5 pb-4">
          <div v-if="builtinAssistant" class="space-y-0.5">
            <div
              :data-testid="`assistant-shell-${builtinAssistant.id}`"
              class="group/assistant relative flex items-center gap-1.5 rounded-[14px] px-2.5 py-1.5 transition-colors duration-150"
              :class="builtinAssistant.id === focusedAssistantId
                ? 'bg-[linear-gradient(180deg,rgba(238,236,255,0.98)_0%,rgba(230,228,255,0.94)_100%)] shadow-[0_10px_22px_rgba(114,111,255,0.10)] ring-1 ring-[rgba(114,111,255,0.12)]'
                : 'opacity-[0.9] hover:bg-white/42 hover:opacity-100'"
            >
              <button
                :data-testid="`assistant-row-${builtinAssistant.id}`"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                @click="focusAssistant(builtinAssistant.id)"
              >
                <div
                  :data-testid="`assistant-avatar-${builtinAssistant.id}`"
                  class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7C73FF,#5D59FF)] text-white ring-1 ring-[#726FFF]/24 shadow-[0_6px_14px_rgba(93,89,255,0.28)]"
                >
                  <span class="text-[12px] font-semibold leading-none">妙</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span :data-testid="`assistant-title-${builtinAssistant.id}`" class="truncate bg-[linear-gradient(90deg,#7B6EFF_0%,#A855F7_100%)] bg-clip-text text-[12px] font-semibold leading-[18px] text-transparent">
                      {{ builtinAssistant.name }}
                    </span>
                    <span class="rounded-full bg-[rgba(114,111,255,0.10)] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#726FFF]">官方</span>
                  </div>
                </div>
              </button>

              <button
                :data-testid="`assistant-new-session-trigger-${builtinAssistant.id}`"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(114,111,255,0.06)] text-[#716DF8] shadow-[0_3px_8px_rgba(114,111,255,0.05)] transition-opacity transition-colors hover:bg-[rgba(114,111,255,0.10)] hover:text-[#5D59FF]"
                :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/assistant:opacity-100'"
                title="新建会话"
                @click.stop="emit('open-new-session', builtinAssistant.id)"
              >
                <Plus class="h-3.5 w-3.5" />
              </button>

              <a-dropdown :trigger="['click']" placement="bottomRight" :destroy-popup-on-hide="true" overlay-class-name="ai-sidebar-assistant-menu-overlay">
                <button
                  :data-testid="`assistant-more-trigger-${builtinAssistant.id}`"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white/70 text-black/42 shadow-[0_3px_8px_rgba(15,23,42,0.03)] transition-opacity transition-colors hover:bg-white"
                  :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/assistant:opacity-100'"
                  title="更多操作"
                >
                  <MoreHorizontal class="h-3.5 w-3.5" />
                </button>
                <template #overlay>
                  <div
                    :data-testid="`assistant-actions-menu-${builtinAssistant.id}`"
                    class="w-[180px] rounded-[16px] bg-[rgba(255,255,255,0.98)] p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-[18px]"
                  >
                    <button
                      data-testid="assistant-menu-edit"
                      class="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[#F6F8FF]"
                      @click.stop="emit('open-view-assistant', builtinAssistant.id)"
                    >
                      <MoreHorizontal class="h-3.5 w-3.5 shrink-0 text-black/46" />
                      <span class="text-[12px] leading-4 text-black/74">查看助手</span>
                    </button>
                  </div>
                </template>
              </a-dropdown>
            </div>

            <div
              v-if="builtinAssistant.id === focusedAssistantId && builtinAssistant.sessions.length > 0"
              :data-testid="`assistant-session-list-${builtinAssistant.id}`"
              class="relative space-y-0.5 pt-1 pl-[38px] pr-1"
            >
              <span aria-hidden="true" class="pointer-events-none absolute bottom-2 left-[14px] top-[4px] w-px bg-[rgba(114,111,255,0.16)]" />
              <div
                v-for="(session, sessionIndex) in builtinAssistant.sessions"
                :key="session.id"
                :data-testid="`assistant-session-row-${builtinAssistant.id}-${session.id}`"
                class="group/session relative flex items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-150"
                :class="session.id === activeSessionId
                  ? 'bg-[linear-gradient(180deg,rgba(242,242,255,0.96)_0%,rgba(236,237,252,0.92)_100%)] text-[#6468A8] ring-1 ring-[rgba(182,188,232,0.34)]'
                  : 'text-black/68 hover:bg-white/80 hover:text-black/84'"
              >
                <span
                  v-if="sessionIndex === builtinAssistant.sessions.length - 1"
                  aria-hidden="true"
                  class="pointer-events-none absolute -bottom-1 left-[-25px] top-1/2 w-[3px] bg-[rgba(255,255,255,0.98)]"
                />
                <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="emit('select-session', builtinAssistant.id, session.id)">
                  <span v-if="session.id === activeSessionId" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#726FFF] shadow-[0_0_0_4px_rgba(114,111,255,0.08)]" />
                  <span :data-testid="`assistant-session-title-${builtinAssistant.id}-${session.id}`" class="min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px]">
                    {{ session.title }}
                  </span>
                </button>
                <a-popconfirm
                  placement="rightTop"
                  title="删除会话"
                  description="删除会话后，聊天记录与产物会一起移除。"
                  ok-text="删除"
                  cancel-text="取消"
                  @confirm="emit('delete-session', builtinAssistant.id, session.id)"
                >
                  <button
                    :data-testid="`session-delete-trigger-${builtinAssistant.id}-${session.id}`"
                    class="flex h-5 w-5 items-center justify-center rounded-[7px] opacity-0 transition-colors hover:bg-[#FEF2F2] group-hover/session:opacity-100"
                    title="删除会话"
                  >
                    <Trash2 class="h-3 w-3 text-[#EF4444]" />
                  </button>
                </a-popconfirm>
              </div>
            </div>
          </div>

          <template v-if="visibleAssistants.length">
            <div
              v-for="{ assistant, sessions, expanded } in visibleAssistants"
              :key="assistant.id"
              class="space-y-0.5"
            >
              <div
                :data-testid="`assistant-shell-${assistant.id}`"
                class="group/assistant relative flex items-center gap-1.5 rounded-[14px] px-2.5 py-1.5 transition-colors duration-150"
                :class="assistant.id === focusedAssistantId
                  ? 'bg-[linear-gradient(180deg,rgba(238,236,255,0.98)_0%,rgba(230,228,255,0.94)_100%)] shadow-[0_10px_22px_rgba(114,111,255,0.10)] ring-1 ring-[rgba(114,111,255,0.12)]'
                  : 'opacity-[0.88] hover:bg-white/42 hover:opacity-100'"
              >
                <button :data-testid="`assistant-row-${assistant.id}`" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="focusAssistant(assistant.id)">
                  <div
                    :data-testid="`assistant-avatar-${assistant.id}`"
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1"
                    :class="assistant.isCollaboration
                      ? 'bg-[linear-gradient(135deg,#E8EEFF,#EEF2FF)] text-[#5E5AE8] ring-[#5E5AE8]/12'
                      : 'bg-[linear-gradient(135deg,#F3F1FF,#E8E5FF)] text-[#726FFF] ring-[#726FFF]/10'"
                  >
                    <Users v-if="assistant.isCollaboration" class="h-3.5 w-3.5" />
                    <span v-else class="text-[11px] font-semibold">{{ assistant.badge }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <span :data-testid="`assistant-title-${assistant.id}`" class="truncate text-[12px] font-medium leading-[18px]" :class="assistant.id === focusedAssistantId ? 'text-black/84' : 'text-black/68'">
                      {{ assistant.name }}
                    </span>
                  </div>
                </button>

                <button
                  :data-testid="`assistant-new-session-trigger-${assistant.id}`"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(114,111,255,0.06)] text-[#716DF8] shadow-[0_3px_8px_rgba(114,111,255,0.05)] transition-opacity transition-colors hover:bg-[rgba(114,111,255,0.10)] hover:text-[#5D59FF]"
                  :class="assistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/assistant:opacity-100'"
                  title="新建会话"
                  @click.stop="emit('open-new-session', assistant.id)"
                >
                  <Plus class="h-3.5 w-3.5" />
                </button>

                <a-dropdown :trigger="['click']" placement="bottomRight" :destroy-popup-on-hide="true" overlay-class-name="ai-sidebar-assistant-menu-overlay">
                  <button
                    :data-testid="`assistant-more-trigger-${assistant.id}`"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white/70 text-black/42 shadow-[0_3px_8px_rgba(15,23,42,0.03)] transition-opacity transition-colors hover:bg-white"
                    :class="assistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/assistant:opacity-100'"
                    title="更多操作"
                  >
                    <MoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                  <template #overlay>
                    <div
                      :data-testid="`assistant-actions-menu-${assistant.id}`"
                      class="w-[180px] rounded-[16px] bg-[rgba(255,255,255,0.98)] p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-[18px]"
                    >
                      <button
                        data-testid="assistant-menu-edit"
                        class="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[#F6F8FF]"
                        @click.stop="emit('open-edit-assistant', assistant.id)"
                      >
                        <MoreHorizontal class="h-3.5 w-3.5 shrink-0 text-black/46" />
                        <span class="text-[12px] leading-4 text-black/74">
                          {{ assistant.isCollaboration ? '编辑群聊模板' : '编辑助手' }}
                        </span>
                      </button>
                      <a-popconfirm
                        placement="rightTop"
                        :title="assistant.isCollaboration ? '删除群聊模板' : '删除助手'"
                        :description="assistant.isCollaboration ? '删除后会移除该群聊模板及其会话。' : '删除后会移除该助手及其全部会话。'"
                        ok-text="删除"
                        cancel-text="取消"
                        @confirm="emit('delete-assistant', assistant.id)"
                      >
                        <button
                          data-testid="assistant-menu-delete"
                          class="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[#FEF2F2]"
                          @click.stop
                        >
                          <Trash2 class="h-3.5 w-3.5 shrink-0 text-[#EF4444]" />
                          <span class="text-[12px] leading-4 text-[#EF4444]">
                            {{ assistant.isCollaboration ? '删除群聊' : '删除助手' }}
                          </span>
                        </button>
                      </a-popconfirm>
                    </div>
                  </template>
                </a-dropdown>
              </div>

              <div
                v-if="expanded && sessions.length > 0"
                :data-testid="`assistant-session-list-${assistant.id}`"
                class="relative space-y-0.5 pt-1 pl-[38px] pr-1"
              >
                <span aria-hidden="true" class="pointer-events-none absolute bottom-2 left-[14px] top-[4px] w-px bg-[rgba(114,111,255,0.16)]" />
                <div
                  v-for="(session, sessionIndex) in sessions"
                  :key="session.id"
                  :data-testid="`assistant-session-row-${assistant.id}-${session.id}`"
                  class="group/session relative flex items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-150"
                  :class="session.id === activeSessionId
                    ? 'bg-[linear-gradient(180deg,rgba(242,242,255,0.96)_0%,rgba(236,237,252,0.92)_100%)] text-[#6468A8] ring-1 ring-[rgba(182,188,232,0.34)]'
                    : 'text-black/68 hover:bg-white/80 hover:text-black/84'"
                >
                  <span aria-hidden="true" class="pointer-events-none absolute left-[-24px] top-1/2 h-px w-[16px] -translate-y-1/2 bg-[rgba(114,111,255,0.22)]" />
                  <span
                    v-if="sessionIndex === sessions.length - 1"
                    aria-hidden="true"
                    class="pointer-events-none absolute -bottom-1 left-[-25px] top-1/2 w-[3px] bg-[rgba(255,255,255,0.98)]"
                  />
                  <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="emit('select-session', assistant.id, session.id)">
                    <span v-if="session.id === activeSessionId" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#726FFF] shadow-[0_0_0_4px_rgba(114,111,255,0.08)]" />
                    <Users v-if="assistant.isCollaboration" class="h-3 w-3 shrink-0 text-[#726FFF]/70" />
                    <span :data-testid="`assistant-session-title-${assistant.id}-${session.id}`" class="min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px]">
                      {{ session.title }}
                    </span>
                  </button>
                  <a-popconfirm
                    placement="rightTop"
                    title="删除会话"
                    description="删除会话后，聊天记录与产物会一起移除。"
                    ok-text="删除"
                    cancel-text="取消"
                    @confirm="emit('delete-session', assistant.id, session.id)"
                  >
                    <button
                      :data-testid="`session-delete-trigger-${assistant.id}-${session.id}`"
                      class="flex h-5 w-5 items-center justify-center rounded-[7px] opacity-0 transition-colors hover:bg-[#FEF2F2] group-hover/session:opacity-100"
                      title="删除会话"
                    >
                      <Trash2 class="h-3 w-3 text-[#EF4444]" />
                    </button>
                  </a-popconfirm>
                </div>
              </div>
            </div>
          </template>

          <div
            v-else
            class="rounded-[18px] bg-white/72 px-4 py-8 text-center text-[12px] leading-5 text-black/42 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
          >
            没有匹配的助手或会话
          </div>
        </div>
      </ScrollArea>
    </div>

    <div class="bg-[rgba(255,255,255,0.6)] px-3.5 pb-4 pt-2 backdrop-blur-[12px]">
      <div class="space-y-2">
        <button
          data-testid="sidebar-entry-automation"
          :class="props.activeSurface === 'automation' ? 'bg-[rgba(114,111,255,0.10)] text-[#726FFF]' : 'bg-white/56 text-black/66 hover:bg-white/80'"
          class="flex w-full items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left transition-colors"
          @click="emit('open-automation')"
        >
          <div :class="props.activeSurface === 'automation' ? 'bg-[#EEF2FF] text-[#726FFF]' : 'bg-[#F4F7FF] text-black/52'" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]">
            <Zap class="h-3.5 w-3.5" />
          </div>
          <span class="min-w-0 flex-1 truncate text-[12px] font-semibold">自动化任务</span>
        </button>

        <button
          data-testid="sidebar-entry-settings"
          :class="props.activeSurface === 'settings' ? 'bg-[rgba(114,111,255,0.10)] text-[#726FFF]' : 'bg-white/56 text-black/66 hover:bg-white/80'"
          class="flex w-full items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left transition-colors"
          @click="emit('open-settings')"
        >
          <div :class="props.activeSurface === 'settings' ? 'bg-[#EEF2FF] text-[#726FFF]' : 'bg-[#F4F7FF] text-black/52'" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]">
            <Settings class="h-3.5 w-3.5" />
          </div>
          <span class="min-w-0 flex-1 truncate text-[12px] font-semibold">配置中心</span>
        </button>
      </div>
    </div>
  </aside>
</template>
