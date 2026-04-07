<script setup lang="ts">
import { Eye, MoreHorizontal, Pencil, Plus, Search, Settings, Trash2, Users, Zap } from 'lucide-vue-next'
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

interface VisibleSidebarGroup {
  id: string
  title: string
  assistants: VisibleSidebarAssistant[]
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
const confirmingAssistantDeleteId = ref<string | null>(null)
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
const visibleGroups = computed<VisibleSidebarGroup[]>(() => {
  const query = normalizedSearchQuery.value

  if (!query) {
    return props.groups
      .map(group => ({
        id: group.id,
        title: group.title,
        assistants: group.assistants.map(assistant => ({
          assistant: {
            ...assistant,
            groupId: group.id,
            isCollaboration: group.id === 'collaboration',
          },
          sessions: assistant.sessions,
          expanded: assistant.id === focusedAssistantId.value && assistant.sessions.length > 0,
        })),
      }))
      .filter(group => group.assistants.length > 0)
  }

  return props.groups
    .map((group) => {
      const assistants = group.assistants.flatMap((assistant) => {
        const assistantMatches = assistant.name.toLocaleLowerCase().includes(query)
        const matchedSessions = assistant.sessions.filter(session =>
          session.title.toLocaleLowerCase().includes(query),
        )

        if (!assistantMatches && matchedSessions.length === 0)
          return []

        return [{
          assistant: {
            ...assistant,
            groupId: group.id,
            isCollaboration: group.id === 'collaboration',
          },
          sessions: assistantMatches ? assistant.sessions : matchedSessions,
          expanded: true,
        }]
      })

      return {
        id: group.id,
        title: group.title,
        assistants,
      }
    })
    .filter(group => group.assistants.length > 0)
})

function resolveAssistantIdBySession(sessionId: string) {
  const found = unifiedAssistants.value.find(assistant =>
    assistant.sessions.some(session => session.id === sessionId),
  )
  if (found)
    return found.id
  if (builtinAssistant.value?.sessions.some(s => s.id === sessionId))
    return builtinAssistant.value.id
  return undefined
}

function syncFocusedAssistant() {
  const assistants = unifiedAssistants.value

  const activeAssistantId = resolveAssistantIdBySession(props.activeSessionId)
  if (activeAssistantId) {
    focusedAssistantId.value = activeAssistantId
    return
  }

  if (!assistants.length) {
    if (builtinAssistant.value)
      focusedAssistantId.value = builtinAssistant.value.id
    return
  }

  if (!assistants.some(assistant => assistant.id === focusedAssistantId.value)) {
    const firstAssistantWithSessions = assistants.find(assistant => assistant.sessions.length > 0)
    focusedAssistantId.value = firstAssistantWithSessions?.id || assistants[0].id
  }
}

watch(() => props.activeSessionId, syncFocusedAssistant, { immediate: true })
watch(unifiedAssistants, syncFocusedAssistant)
watch(builtinAssistant, syncFocusedAssistant)

function canExpand(assistant: StudioAssistant) {
  return assistant.sessions.length > 0
}

function focusAssistant(assistantId: string) {
  focusedAssistantId.value = assistantId
  confirmingAssistantDeleteId.value = null
  emit('set-focused-assistant', assistantId)
  emit('click-assistant', assistantId)
}

function isRunning(assistant: SidebarAssistantEntry) {
  return assistant.status === '运行中'
}

function assistantAvatarTone(assistantId: string) {
  if (assistantId === 'office')
    return 'bg-[linear-gradient(135deg,#EFF6FF,#DBEAFE)] text-[#1D4ED8] ring-[#1D4ED8]/10'
  if (assistantId === 'code')
    return 'bg-[linear-gradient(135deg,#F0FDF4,#DCFCE7)] text-[#16A34A] ring-[#16A34A]/10'
  if (assistantId === 'data')
    return 'bg-[linear-gradient(135deg,#FFF7ED,#FFEDD5)] text-[#EA580C] ring-[#EA580C]/10'
  return 'bg-[linear-gradient(135deg,#F3F1FF,#E8E5FF)] text-[#726FFF] ring-[#726FFF]/10'
}

function getAssistantById(assistantId: string) {
  return unifiedAssistants.value.find(assistant => assistant.id === assistantId) || null
}

function groupAvatarMembers(assistant: SidebarAssistantEntry) {
  const memberIds = assistant.groupParticipantAssistantIds || []
  return memberIds
    .map(id => getAssistantById(id))
    .filter((item): item is SidebarAssistantEntry => Boolean(item))
    .slice(0, 2)
}

function groupAvatarTone(memberBadge: string) {
  if (memberBadge === '代')
    return 'bg-[#16A34A] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.96)]'
  if (memberBadge === '数')
    return 'bg-[#EA580C] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.96)]'
  if (memberBadge === '办')
    return 'bg-[#1D4ED8] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.96)]'
  return 'bg-[#726FFF] text-white shadow-[0_0_0_2px_rgba(255,255,255,0.96)]'
}

function groupAvatarLabel(assistant: SidebarAssistantEntry) {
  return assistant.badge?.slice(0, 1) || assistant.name.slice(0, 1).toUpperCase() || '助'
}

function collaborationModeLabel(mode?: StudioAssistant['groupCollaborationMode']) {
  if (mode === 'pipeline')
    return '流水协作'
  if (mode === 'race')
    return '并行竞答'
  if (mode === 'debate')
    return '辩论协作'
  return '自动协作'
}

function groupSummary(assistant: SidebarAssistantEntry) {
  const memberCount = assistant.groupParticipantAssistantIds?.length || 0
  if (memberCount === 0)
    return collaborationModeLabel(assistant.groupCollaborationMode)
  return `${memberCount} 位成员 · ${collaborationModeLabel(assistant.groupCollaborationMode)}`
}

function handleAssistantMenuAction(action: 'edit' | 'delete', assistantId: string) {
  if (action !== 'delete')
    confirmingAssistantDeleteId.value = null
  if (action === 'edit') {
    emit('open-edit-assistant', assistantId)
    return
  }
  emit('delete-assistant', assistantId)
}

function showAssistantDeleteConfirm(assistantId: string) {
  confirmingAssistantDeleteId.value = assistantId
}

function cancelAssistantDeleteConfirm() {
  confirmingAssistantDeleteId.value = null
}

function toggleCreateMenu() {
  createMenuOpen.value = !createMenuOpen.value
}

function closeCreateMenu() {
  createMenuOpen.value = false
}

function handleCreateAssistant() {
  closeCreateMenu()
  emit('open-new-assistant')
}

function handleCreateGroupTemplate() {
  closeCreateMenu()
  emit('open-new-group-template')
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!createMenuOpen.value)
    return

  const anchor = createMenuAnchorRef.value
  if (!anchor)
    return

  if (anchor.contains(event.target as Node))
    return

  closeCreateMenu()
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
        @click="toggleCreateMenu"
      >
        <Plus class="h-4 w-4" />
        <span>新建</span>
      </Button>
      <div
        v-if="createMenuOpen"
        class="absolute inset-x-4 top-[calc(100%-2px)] z-20 pt-2"
      >
        <div class="w-full overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(248,249,255,0.95)_100%)] p-2 shadow-[0_14px_28px_rgba(15,23,42,0.10)]">
          <button
            data-testid="create-assistant-template"
            class="flex w-full appearance-none items-center gap-2 rounded-[14px] border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-[rgba(114,111,255,0.08)]"
            @click="handleCreateAssistant"
          >
            <Plus class="h-3.5 w-3.5 text-black/52" />
            <span class="text-[12px] leading-4 text-black/74">新建助手模板</span>
          </button>
          <button
            data-testid="create-group-template"
            class="mt-1 flex w-full appearance-none items-center gap-2 rounded-[14px] border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-[rgba(114,111,255,0.08)]"
            @click="handleCreateGroupTemplate"
          >
            <Users class="h-3.5 w-3.5 text-[#5E5AE8]" />
            <span class="text-[12px] leading-4 text-black/74">新建群聊模板</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 星小妙置顶卡片 -->
    <div v-if="builtinAssistant" class="px-3 pb-2 pt-1">
      <div
        :data-testid="`assistant-shell-${builtinAssistant.id}`"
        class="group/builtin relative cursor-pointer overflow-hidden rounded-[16px] bg-[linear-gradient(135deg,rgba(114,111,255,0.09),rgba(93,89,255,0.05))] ring-1 ring-[rgba(114,111,255,0.12)] transition-all duration-150"
        :class="builtinAssistant.id === focusedAssistantId
          ? 'bg-[linear-gradient(135deg,rgba(114,111,255,0.14),rgba(93,89,255,0.09))] ring-[rgba(114,111,255,0.22)] shadow-[0_6px_18px_rgba(114,111,255,0.10)]'
          : 'hover:bg-[linear-gradient(135deg,rgba(114,111,255,0.11),rgba(93,89,255,0.07))] hover:ring-[rgba(114,111,255,0.16)]'"
        @click="focusAssistant(builtinAssistant.id)"
      >
        <div class="flex items-center gap-2.5 px-3 py-2.5">
          <!-- 头像 -->
          <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] shadow-[0_4px_12px_rgba(114,111,255,0.28)]">
            <span class="text-[13px] font-bold text-white">{{ builtinAssistant.badge }}</span>
            <!-- 官方角标 -->
            <div class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#726FFF] ring-2 ring-white">
              <svg class="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 1l1.236 2.506L10 3.82l-2 1.95.472 2.75L6 7.25 3.528 8.52 4 5.77 2 3.82l2.764-.314z"/>
              </svg>
            </div>
          </div>

          <!-- 名称和标签 -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-[12px] font-semibold text-[#4F4BCC]">{{ builtinAssistant.name }}</span>
              <span class="shrink-0 rounded-full bg-[rgba(114,111,255,0.10)] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#726FFF]">官方</span>
            </div>
            <span class="mt-0.5 block truncate text-[11px] leading-[16px] text-black/42">万能助手 · 开箱即用</span>
          </div>

          <!-- 新建会话按钮 -->
          <button
            :data-testid="`assistant-new-session-trigger-${builtinAssistant.id}`"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(114,111,255,0.08)] text-[#716DF8] transition-all hover:bg-[rgba(114,111,255,0.16)]"
            :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/builtin:opacity-100'"
            title="新建会话"
            @click.stop="emit('open-new-session', builtinAssistant.id)"
          >
            <Plus class="h-3.5 w-3.5" />
          </button>

          <!-- 只读查看按钮 -->
          <button
            :data-testid="`assistant-view-trigger-${builtinAssistant.id}`"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white/60 text-black/36 transition-all hover:bg-white/90"
            :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : 'opacity-0 group-hover/builtin:opacity-100'"
            title="查看助手"
            @click.stop="emit('open-view-assistant', builtinAssistant.id)"
          >
            <Eye class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- 会话列表（展开时） -->
        <div
          v-if="builtinAssistant.id === focusedAssistantId && builtinAssistant.sessions.length > 0"
          class="space-y-0.5 px-3 pb-2"
        >
          <div
            v-for="session in builtinAssistant.sessions"
            :key="session.id"
            :data-testid="`assistant-session-row-${builtinAssistant.id}-${session.id}`"
            class="group/session relative flex items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-150"
            :class="session.id === activeSessionId
              ? 'bg-[linear-gradient(180deg,rgba(242,242,255,0.96)_0%,rgba(236,237,252,0.92)_100%)] text-[#6468A8] ring-1 ring-[rgba(182,188,232,0.34)]'
              : 'text-black/54 hover:bg-[rgba(255,255,255,0.70)] hover:text-black/72'"
          >
            <button
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              @click="emit('select-session', builtinAssistant.id, session.id)"
            >
              <span
                v-if="session.id === activeSessionId"
                class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#726FFF] shadow-[0_0_0_4px_rgba(114,111,255,0.08)]"
              />
              <span class="min-w-0 flex-1 truncate text-[11px] font-medium leading-[18px]">{{ session.title }}</span>
            </button>
            <div class="flex shrink-0 items-center gap-1 opacity-0 transition-all group-hover/session:opacity-100">
              <a-popconfirm
                placement="rightTop"
                title="删除会话"
                description="删除会话后，当前聊天记录和右侧产物预览将一并移除。"
                ok-text="删除会话"
                cancel-text="取消"
                @confirm="emit('delete-session', builtinAssistant.id, session.id)"
              >
                <button
                  :data-testid="`session-delete-trigger-${builtinAssistant.id}-${session.id}`"
                  class="flex h-5 w-5 items-center justify-center rounded-[7px] transition-colors hover:bg-[#FEF2F2]"
                  title="删除会话"
                >
                  <Trash2 class="h-3 w-3 text-[#EF4444]" />
                </button>
              </a-popconfirm>
            </div>
          </div>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="mt-2 h-px bg-[rgba(114,111,255,0.08)]" />
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
        <template v-if="visibleGroups.length">
          <section
            v-for="group in visibleGroups"
            :key="group.id"
            :data-testid="`assistant-group-${group.id}`"
            class="space-y-1.5"
          >
            <div class="px-2.5 pb-0.5 pt-2">
              <div class="flex items-center gap-2">
                <span
                  class="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/34"
                  :class="group.id === 'collaboration' ? 'text-[#726FFF]/72' : ''"
                >
                  {{ group.title }}
                </span>
                <span class="h-px flex-1 bg-[linear-gradient(90deg,rgba(114,111,255,0.12),transparent)]" />
              </div>
            </div>

            <div
              v-for="{ assistant, sessions, expanded } in group.assistants"
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
                <button
                  :data-testid="`assistant-row-${assistant.id}`"
                  class="flex min-w-0 flex-1 items-center gap-2 text-left"
                  @click="focusAssistant(assistant.id)"
                >
                  <div
                    v-if="!assistant.isCollaboration"
                    :data-testid="`assistant-avatar-${assistant.id}`"
                    :class="assistantAvatarTone(assistant.id)"
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] ring-1"
                  >
                    <span class="text-[11px] font-semibold">{{ assistant.badge }}</span>
                  </div>
                  <div
                    v-else
                    :data-testid="`assistant-avatar-${assistant.id}`"
                    class="relative h-8 w-9 shrink-0"
                  >
                    <div
                      v-for="(memberAssistant, index) in groupAvatarMembers(assistant)"
                      :key="memberAssistant.id"
                      :class="groupAvatarTone(groupAvatarLabel(memberAssistant))"
                      :style="{ left: `${index * 12}px`, top: index === 0 ? '1px' : '7px' }"
                      class="absolute flex h-6 w-6 items-center justify-center rounded-[9px] text-[9px] font-bold"
                    >
                      {{ groupAvatarLabel(memberAssistant) }}
                    </div>
                    <div
                      v-if="groupAvatarMembers(assistant).length === 0"
                      class="absolute left-0 top-1 flex h-7 w-7 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#F3F1FF,#E8E5FF)] text-[10px] font-semibold text-[#726FFF] shadow-[0_0_0_2px_rgba(255,255,255,0.96)]"
                    >
                      协
                    </div>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        :data-testid="`assistant-title-${assistant.id}`"
                        class="truncate text-[12px] font-medium leading-[18px]"
                        :class="assistant.id === focusedAssistantId ? 'text-black/84' : 'text-black/68'"
                      >
                        {{ assistant.name }}
                      </span>
                      <span
                        v-if="assistant.isCollaboration"
                        class="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(114,111,255,0.08)] px-2 py-0.5 text-[10px] font-medium text-[#726FFF]"
                      >
                        <Users class="h-3 w-3" />
                        <span>群聊</span>
                      </span>
                      <span
                        v-if="isRunning(assistant)"
                        class="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10px] font-medium text-[#16A34A]"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-[#2FCB64]" />
                        <span>运行中</span>
                      </span>
                    </div>
                    <div
                      v-if="assistant.isCollaboration"
                      class="truncate pt-0.5 text-[10px] leading-4 text-black/44"
                    >
                      {{ groupSummary(assistant) }}
                    </div>
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
                        @click.stop="handleAssistantMenuAction('edit', assistant.id)"
                      >
                        <Pencil class="h-3.5 w-3.5 shrink-0 text-black/46" />
                        <span class="text-[12px] leading-4 text-black/74">编辑助手</span>
                      </button>
                      <button
                        v-if="confirmingAssistantDeleteId !== assistant.id"
                        data-testid="assistant-menu-delete"
                        class="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[#FEF2F2]"
                        @click.stop="showAssistantDeleteConfirm(assistant.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5 shrink-0 text-[#EF4444]" />
                        <span class="text-[12px] leading-4 text-[#EF4444]">删除助手</span>
                      </button>
                      <div v-else class="rounded-[14px] bg-[#FFF6F5] px-3 py-2.5">
                        <div class="text-[11px] font-medium leading-4 text-[#D14343]">删除后将同时移除该助手下的全部会话与产物视图。</div>
                        <div class="mt-2 flex items-center justify-end gap-2">
                          <button
                            class="rounded-[10px] px-2.5 py-1 text-[11px] leading-4 text-black/44 transition-colors hover:bg-white/70"
                            @click.stop="cancelAssistantDeleteConfirm()"
                          >
                            取消
                          </button>
                          <button
                            class="rounded-[10px] bg-[#EF4444] px-2.5 py-1 text-[11px] leading-4 text-white shadow-[0_8px_18px_rgba(239,68,68,0.16)]"
                            @click.stop="handleAssistantMenuAction('delete', assistant.id)"
                          >
                            删除助手
                          </button>
                        </div>
                      </div>
                    </div>
                  </template>
                </a-dropdown>
              </div>

              <div
                v-if="expanded && canExpand(assistant)"
                :data-testid="`assistant-session-list-${assistant.id}`"
                class="relative space-y-0.5 pt-1 pl-[38px] pr-1"
              >
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute bottom-2 left-[14px] top-[4px] w-px bg-[rgba(114,111,255,0.16)]"
                />
                <div
                  v-for="(session, sessionIndex) in sessions"
                  :key="session.id"
                  :data-testid="`assistant-session-row-${assistant.id}-${session.id}`"
                  class="group/session relative flex items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-150"
                  :class="session.id === activeSessionId
                    ? 'bg-[linear-gradient(180deg,rgba(242,242,255,0.96)_0%,rgba(236,237,252,0.92)_100%)] text-[#6468A8] ring-1 ring-[rgba(182,188,232,0.34)]'
                    : 'text-black/68 hover:bg-white/80 hover:text-black/84'"
                >
                  <span
                    aria-hidden="true"
                    class="pointer-events-none absolute left-[-24px] top-1/2 h-px w-[16px] -translate-y-1/2 bg-[rgba(114,111,255,0.22)]"
                  />
                  <span
                    v-if="sessionIndex === sessions.length - 1"
                    aria-hidden="true"
                    class="pointer-events-none absolute -bottom-1 left-[-25px] top-1/2 w-[3px] bg-[rgba(255,255,255,0.98)]"
                  />
                  <button
                    class="flex min-w-0 flex-1 items-center gap-2 text-left"
                    @click="emit('select-session', assistant.id, session.id)"
                  >
                    <span
                      v-if="session.id === activeSessionId"
                      class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#726FFF] shadow-[0_0_0_4px_rgba(114,111,255,0.08)]"
                    />
                    <span
                      :data-testid="`assistant-session-title-${assistant.id}-${session.id}`"
                      class="min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px]"
                    >
                      {{ session.title }}
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center gap-1 opacity-0 transition-all group-hover/session:opacity-100">
                    <a-popconfirm
                      placement="rightTop"
                      title="删除会话"
                      description="删除会话后，当前聊天记录和右侧产物预览将一并移除。"
                      ok-text="删除会话"
                      cancel-text="取消"
                      @confirm="emit('delete-session', assistant.id, session.id)"
                    >
                      <button
                        :data-testid="`session-delete-trigger-${assistant.id}-${session.id}`"
                        class="flex h-5 w-5 items-center justify-center rounded-[7px] transition-colors hover:bg-[#FEF2F2]"
                        title="删除会话"
                      >
                        <Trash2 class="h-3 w-3 text-[#EF4444]" />
                      </button>
                    </a-popconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>
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
          <div
            :class="props.activeSurface === 'automation' ? 'bg-[#EEF2FF] text-[#726FFF]' : 'bg-[#F4F7FF] text-black/52'"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]"
          >
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
          <div
            :class="props.activeSurface === 'settings' ? 'bg-[#EEF2FF] text-[#726FFF]' : 'bg-[#F4F7FF] text-black/52'"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px]"
          >
            <Settings class="h-3.5 w-3.5" />
          </div>
          <span class="min-w-0 flex-1 truncate text-[12px] font-semibold">配置中心</span>
        </button>
      </div>
    </div>

  </aside>
</template>

<style scoped>
</style>
