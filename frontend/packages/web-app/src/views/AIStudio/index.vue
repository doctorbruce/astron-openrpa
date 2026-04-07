<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Bot, Check, ChevronDown, FolderOpen, Sparkles, Users, UserRound } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AutomationTaskView from './components/AutomationTaskView.vue'
import ArtifactPanel from './components/ArtifactPanel.vue'
import BuiltinWelcomeView from './components/BuiltinWelcomeView.vue'
import InviteAssistantModal from './components/InviteAssistantModal.vue'
import NewAssistantModal from './components/NewAssistantModal.vue'
import SettingsCenterView from './components/SettingsCenterView.vue'
import StudioChatPane from './components/StudioChatPane.vue'
import DiffuseLight from '@/components/Illustration/DiffuseLight.vue'
import { Button } from '@/components/ui/button'
import { useAIStudioStore } from '@/stores/useAIStudioStore'

const aiStudioStore = useAIStudioStore()
const route = useRoute()
const router = useRouter()
const {
  activeSession,
  activeSessionLoading,
  activeSurface,
  assistantGroups,
  assistantModalMode,
  assistantTemplateKind,
  editingAssistant,
  invitedAssistants,
  isActiveSessionPending,
  isAiTyping,
  newSessionParticipantCandidates,
  sessionModelSelection,
  sessionMap,
  showBuiltinWelcome,
  showInviteAssistant,
  showNewAssistant,
  workspaceOpen,
} = storeToRefs(aiStudioStore)

const assistantOptionCatalog = computed(() =>
  assistantGroups.value.flatMap(group => group.assistants.map(assistant => ({
    id: assistant.id,
    name: assistant.name,
    badge: assistant.badge,
    status: assistant.status,
    isBuiltin: assistant.isBuiltin,
    workspacePath: assistant.workspacePath,
    persona: assistant.persona,
    capabilities: assistant.capabilities,
    skillIds: assistant.skillIds || [],
    skills: assistant.skills || [],
    sessions: assistant.sessions,
    groupParticipantAssistantIds: assistant.groupParticipantAssistantIds || [],
    groupCollaborationMode: assistant.groupCollaborationMode,
    avatar: (assistant as typeof assistant & { avatar?: string }).avatar || '',
  }))),
)

const assistantById = computed(() =>
  new Map(assistantOptionCatalog.value.map(assistant => [assistant.id, assistant])),
)

const activeSessionAssistant = computed(() => {
  const sessionId = activeSession.value?.id
  if (!sessionId)
    return null

  return assistantOptionCatalog.value.find(assistant =>
    assistant.sessions.some(session => session.id === sessionId),
  ) || null
})

const composerSkillOptions = computed(() =>
  (activeSessionAssistant.value?.skills || []).map(skill => ({
    id: skill.name,
    label: skill.name,
    badge: skill.name.slice(0, 1).toUpperCase() || 'S',
    description: skill.description || `褰撳墠鍔╂墜宸茶繛鎺ユ妧鑳斤細${skill.name}`,
  })),
)

const composerMentionOptions = computed(() => {
  if (activeSession.value?.mode !== 'group')
    return []

  const participantIds = [...new Set(activeSession.value.participantAssistantIds || [])]
  return participantIds.map((id) => {
    const matched = assistantOptionCatalog.value.find(assistant => assistant.id === id)
    if (matched) {
      return {
        id,
        label: matched.name,
        badge: matched.badge || matched.name.slice(0, 1).toUpperCase() || 'A',
        description: `鎻愬強 ${matched.name}`,
      }
    }

    return {
      id,
      label: id,
      badge: id.slice(0, 1).toUpperCase() || 'A',
      description: `鎻愬強 ${id}`,
    }
  })
})

const isEditingBuiltin = computed(() => editingAssistant.value?.isBuiltin ?? false)
const focusedAssistant = computed(() => {
  const id = aiStudioStore.focusedAssistantId
  if (!id)
    return null
  return assistantOptionCatalog.value.find(assistant => assistant.id === id) || null
})

const focusedAssistantIsGroup = computed(() =>
  !!focusedAssistant.value?.groupParticipantAssistantIds?.length || !!focusedAssistant.value?.groupCollaborationMode,
)

const focusedGroupParticipants = computed(() => {
  const participantIds = focusedAssistant.value?.groupParticipantAssistantIds || []
  return participantIds
    .map((id) => assistantById.value.get(id))
    .filter((assistant): assistant is NonNullable<typeof assistant> => Boolean(assistant))
    .filter(assistant => !assistant.isBuiltin)
})

const focusedAssistantAvatar = computed(() => focusedAssistant.value?.avatar?.trim() || '')
const focusedProfileSummary = computed(() => {
  if (!focusedAssistant.value)
    return '这个助手暂未配置信息。'

  const summaryParts = [focusedAssistant.value.persona?.trim(), focusedAssistant.value.capabilities?.trim()].filter(Boolean)
  if (!summaryParts.length)
    return '这个助手暂未配置信息，你可以在配置中补充角色与能力描述。'
  return summaryParts.join(' 路 ')
})
const shouldCollapsePersona = computed(() => focusedProfileSummary.value.length > 92)
const personaExpanded = ref(false)
const landingWorkspacePath = ref('~/Documents')
const workspacePopoverOpen = ref(false)
const workspaceHistory = ref<string[]>([])

type LandingSkillItem = {
  id: string
  name: string
}

const focusedSkillItems = computed<LandingSkillItem[]>(() => {
  const merged = new Map<string, LandingSkillItem>()
  const skillsFromObjects = focusedAssistant.value?.skills || []
  const skillsFromIds = focusedAssistant.value?.skillIds || []

  skillsFromObjects.forEach((skill) => {
    const normalizedName = skill.name?.trim()
    if (!normalizedName)
      return
    const key = skill.id?.trim() || normalizedName
    if (!merged.has(key))
      merged.set(key, { id: key, name: normalizedName })
  })

  skillsFromIds.forEach((skillId) => {
    const normalizedName = skillId?.trim()
    if (!normalizedName)
      return
    if (!merged.has(normalizedName))
      merged.set(normalizedName, { id: normalizedName, name: normalizedName })
  })

  return [...merged.values()]
})

const visibleFocusedSkillItems = computed(() => focusedSkillItems.value.slice(0, 5))
const hiddenSkillCount = computed(() => Math.max(0, focusedSkillItems.value.length - visibleFocusedSkillItems.value.length))
const landingWorkspaceDisplay = computed(() =>
  formatPath(landingWorkspacePath.value || '~/Documents'),
)

function formatPath(rawPath: string) {
  const value = rawPath.trim() || '~/Documents'
  const normalized = value.replace(/\//g, '\\')
  const isAbsoluteWindowsPath = /^[A-Za-z]:\\/.test(normalized)
  const containsWorkspacePath = /\\workspaces(\\|$)/i.test(normalized)

  if (isAbsoluteWindowsPath && (containsWorkspacePath || normalized.length > 64)) {
    const segments = normalized.split('\\').filter(Boolean)
    const workspaceIndex = segments.findIndex(segment => segment.toLowerCase() === 'workspaces')
    const fallbackId = segments[segments.length - 1] || 'workspace'
    const assistantId = focusedAssistant.value?.id || fallbackId

    if (workspaceIndex >= 0)
      return `~/workspaces/.../${assistantId}`
    return `~/workspaces/.../${assistantId}`
  }

  if (value.length <= 60)
    return value

  return `${value.slice(0, 24)}...${value.slice(-18)}`
}

const workspaceCandidates = computed(() => {
  if (!focusedAssistant.value || focusedAssistant.value.isBuiltin || focusedAssistantIsGroup.value)
    return []

  const values: string[] = []
  const assistantWorkspace = focusedAssistant.value.workspacePath?.trim()
  if (assistantWorkspace)
    values.push(assistantWorkspace)

  focusedAssistant.value.sessions.forEach((session) => {
    const path = sessionMap.value[session.id]?.workspacePath?.trim()
    if (path)
      values.push(path)
  })

  return [...new Set(values)]
})

const workspacePopoverItems = computed(() => {
  const values = [landingWorkspacePath.value, ...workspaceHistory.value, ...workspaceCandidates.value]
    .map(path => path.trim())
    .filter(Boolean)
  return [...new Set(values)].slice(0, 3)
})

function rememberWorkspace(path?: string | null) {
  const normalized = path?.trim()
  if (!normalized)
    return
  workspaceHistory.value = [normalized, ...workspaceHistory.value.filter(item => item !== normalized)].slice(0, 3)
}

watch(
  () => focusedAssistant.value?.id,
  () => {
    personaExpanded.value = false
    workspacePopoverOpen.value = false
    const firstWorkspace = workspaceCandidates.value[0]
    landingWorkspacePath.value = firstWorkspace || focusedAssistant.value?.workspacePath || '~/Documents'
    rememberWorkspace(landingWorkspacePath.value)
  },
  { immediate: true },
)

watch(workspaceCandidates, (next) => {
  if (!next.length)
    return
  if (!next.includes(landingWorkspacePath.value))
    landingWorkspacePath.value = next[0]
  next.forEach(path => rememberWorkspace(path))
})

onMounted(() => {
  document.body.classList.add('ai-assistant-preview')
})

onBeforeUnmount(() => {
  document.body.classList.remove('ai-assistant-preview')
})

function collaborationModeLabel(mode?: 'auto' | 'pipeline' | 'race' | 'debate') {
  if (mode === 'pipeline')
    return '流水线'
  if (mode === 'race')
    return '璧涢┈'
  if (mode === 'debate')
    return '浼氬'
  return '鑷姩'
}

function handleCloseSurface() {
  aiStudioStore.openSurface('main')
}

async function handleAssistantSubmit(payload: {
  name: string
  workspacePath: string
  persona: string
  capabilities: string
  skills: string[]
  templateKind: 'assistant' | 'group'
  groupParticipantAssistantIds?: string[]
  groupCollaborationMode?: 'auto' | 'pipeline' | 'race' | 'debate'
}) {
  if (assistantModalMode.value === 'edit' && editingAssistant.value) {
    await aiStudioStore.updateAssistant(editingAssistant.value.id, payload)
    return
  }

  await aiStudioStore.createAssistant(payload)
}

function openFocusedAssistantConfig() {
  if (!focusedAssistant.value)
    return
  aiStudioStore.openEditAssistant(focusedAssistant.value.id)
}

function togglePersonaExpand() {
  personaExpanded.value = !personaExpanded.value
}

function selectWorkspaceFromPopover(path: string) {
  landingWorkspacePath.value = path
  workspacePopoverOpen.value = false
  rememberWorkspace(path)
}

async function pickLandingWorkspace() {
  const api = typeof window !== 'undefined' ? window.opencodeApi : null
  if (!api?.pickWorkspace || focusedAssistantIsGroup.value || focusedAssistant.value?.isBuiltin)
    return
  const result = await api.pickWorkspace(landingWorkspacePath.value || null) as { canceled: boolean, path: string | null }
  if (!result.canceled && result.path) {
    landingWorkspacePath.value = result.path
    workspacePopoverOpen.value = false
    rememberWorkspace(result.path)
  }
}

async function startFocusedAssistantSession() {
  if (!focusedAssistant.value)
    return

  if (focusedAssistant.value.isBuiltin) {
    const sessionId = await aiStudioStore.startBuiltinChat('璇峰府鎴戝惎鍔ㄤ竴涓柊鐨勬槦灏忓浼氳瘽')
    if (sessionId) {
      await router.replace({
        query: {
          ...route.query,
          sessionId,
        },
      })
    }
    return
  }

  if (focusedAssistantIsGroup.value) {
    const sessionId = await aiStudioStore.createSessionForAssistant(focusedAssistant.value.id)
    if (sessionId) {
      await router.replace({
        query: {
          ...route.query,
          sessionId,
        },
      })
    }
    return
  }

  const sessionId = await aiStudioStore.createSessionForAssistant(focusedAssistant.value.id, {
    workspacePath: landingWorkspacePath.value,
  })
  if (sessionId) {
    await router.replace({
      query: {
        ...route.query,
        sessionId,
      },
    })
    aiStudioStore.setWorkspaceOpen(false)
  }
}

async function handleLaunchPadStart() {
  await startFocusedAssistantSession()
}
</script>

<template>
  <div
    class="relative h-full overflow-hidden bg-[#F6F8FF]"
    style="font-family: var(--font-sans-ui);"
  >
    <DiffuseLight height="100%" class="pointer-events-none absolute right-0 top-0 h-full w-full opacity-[0.32]" />
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[240px] bg-[radial-gradient(circle_at_32%_0%,rgba(114,111,255,0.10),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.54)_0%,rgba(255,255,255,0)_100%)]" />
    <div class="pointer-events-none absolute bottom-0 left-[12%] h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(114,111,255,0.07)_0%,rgba(114,111,255,0)_72%)] blur-xl" />

    <div
      v-if="activeSession"
      class="relative z-10 flex h-full min-h-0 min-w-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.38)_0%,rgba(255,255,255,0.12)_100%)]"
    >
      <template v-if="activeSurface === 'main'">
        <StudioChatPane
          :available-skills="composerSkillOptions"
          :session-model-selection="sessionModelSelection"
          :mention-options="composerMentionOptions"
          :invited-assistants="invitedAssistants"
          :session="activeSession"
          :session-pending="isActiveSessionPending"
          :is-ai-typing="isAiTyping"
          :workspace-open="workspaceOpen"
          :is-action-pending="aiStudioStore.isActionPending"
          :is-card-pending="aiStudioStore.isCardPending"
          @open-invite="aiStudioStore.openInviteAssistant()"
          @abort-session="aiStudioStore.abortSession()"
          @rename-session="aiStudioStore.renameSession($event.sessionId, $event.title)"
          @select-session-model="aiStudioStore.saveSessionModelOverride($event)"
          @clear-session-model="aiStudioStore.clearSessionModelOverride()"
          @send-message="aiStudioStore.sendMessage($event)"
          @submit-action="aiStudioStore.submitCardAction($event)"
          @submit-choice="aiStudioStore.submitChoiceForm($event)"
          @submit-param="aiStudioStore.submitParamForm($event)"
          @toggle-workspace="aiStudioStore.toggleWorkspace()"
        />
        <ArtifactPanel
          v-if="workspaceOpen"
          :session="activeSession"
          @close="aiStudioStore.setWorkspaceOpen(false)"
          @select-artifact="aiStudioStore.selectArtifact"
        />
      </template>
      <template v-else-if="activeSurface === 'automation'">
        <AutomationTaskView @close="handleCloseSurface" />
      </template>
      <template v-else>
        <StudioChatPane
          :available-skills="composerSkillOptions"
          :session-model-selection="sessionModelSelection"
          :mention-options="composerMentionOptions"
          :invited-assistants="invitedAssistants"
          :session="activeSession"
          :session-pending="isActiveSessionPending"
          :workspace-open="workspaceOpen"
          :is-action-pending="aiStudioStore.isActionPending"
          :is-card-pending="aiStudioStore.isCardPending"
          class="pointer-events-none opacity-30 blur-[1px]"
          @abort-session="aiStudioStore.abortSession()"
          @rename-session="aiStudioStore.renameSession($event.sessionId, $event.title)"
          @select-session-model="aiStudioStore.saveSessionModelOverride($event)"
          @clear-session-model="aiStudioStore.clearSessionModelOverride()"
        />
        <SettingsCenterView @close="handleCloseSurface" />
      </template>
    </div>

    <div v-else class="relative z-10 flex h-full">
      <template v-if="showBuiltinWelcome || focusedAssistant?.isBuiltin">
        <BuiltinWelcomeView @start-chat="aiStudioStore.startBuiltinChat($event)" />
      </template>
      <template v-else-if="focusedAssistant && focusedAssistantIsGroup">
        <div class="flex h-full w-full items-center justify-center overflow-y-auto px-8 py-8">
          <div class="mx-auto flex w-full max-w-[860px] flex-col gap-5">
            <section class="relative overflow-hidden rounded-2xl border border-[#ECEEF5] bg-[linear-gradient(135deg,#FFFFFF_0%,#F8F7FF_58%,#F0EDFF_100%)] p-5 shadow-sm">
              <div class="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(119,103,255,0.20),rgba(119,103,255,0))]" />
              <div class="flex items-start gap-4">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#F2EEFF,#E8E2FF)] text-[#5B4EF2] ring-1 ring-[#DDD4FF]">
                  <Users class="h-7 w-7" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-medium text-[#5B4EF2] ring-1 ring-[#D9D2FF]">
                    <Sparkles class="h-3.5 w-3.5" />
                    <span>协作工作台</span>
                  </div>
                  <h2 class="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">{{ focusedAssistant.name }}</h2>
                  <p class="mt-1.5 max-w-[640px] text-[13px] leading-6 text-gray-600 line-clamp-3">{{ focusedProfileSummary }}</p>
                </div>
              </div>
            </section>

            <section class="grid gap-4 md:grid-cols-2">
              <div class="rounded-xl border border-[#ECEEF5] bg-white p-4 shadow-sm">
                <div class="text-sm font-semibold text-gray-800">协作模式</div>
                <div class="mt-3 inline-flex rounded-full bg-[#EEE9FF] px-3 py-1 text-xs font-medium text-[#5E4EF2]">
                  {{ collaborationModeLabel(focusedAssistant.groupCollaborationMode) }}
                </div>
                <div class="mt-3 rounded-xl bg-[#F8F7FF] px-3 py-2 text-xs leading-6 text-gray-600">
                  <template v-if="focusedAssistant.groupCollaborationMode === 'pipeline'">A -> B -> C 串行推进</template>
                  <template v-else-if="focusedAssistant.groupCollaborationMode === 'race'">多助手并行赛马，择优输出</template>
                  <template v-else-if="focusedAssistant.groupCollaborationMode === 'debate'">多助手会审辩论，协调收敛</template>
                  <template v-else>系统自动调度协作路径</template>
                </div>
              </div>

              <div class="rounded-xl border border-[#ECEEF5] bg-white p-4 shadow-sm">
                <div class="text-sm font-semibold text-gray-800">共享工作区</div>
                <div class="mt-3 rounded-xl bg-[#F8F7FF] px-3 py-2 text-xs text-gray-700" :title="focusedAssistant.workspacePath || '~/Documents'">
                  {{ formatPath(focusedAssistant.workspacePath || '~/Documents') }}
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-[#ECEEF5] bg-white p-4 shadow-sm">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[15px] font-semibold text-gray-800">技能库收纳</div>
                <div class="text-xs text-gray-400">Skills</div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2.5">
                <button
                  v-for="skill in visibleFocusedSkillItems"
                  :key="skill.id"
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F1EEFF] px-3 text-xs text-[#5E4EF2] ring-1 ring-[#DDD6FF]"
                  @click="openFocusedAssistantConfig"
                >
                  <Bot class="h-3.5 w-3.5" />
                  <span>{{ skill.name }}</span>
                </button>
                <button
                  v-if="hiddenSkillCount > 0"
                  type="button"
                  class="inline-flex h-8 items-center rounded-full bg-[#EEF2FF] px-3 text-xs font-medium text-[#4C46E8] ring-1 ring-[#DDE3FF]"
                  @click="openFocusedAssistantConfig"
                >
                  + 查看全部 ({{ hiddenSkillCount }})
                </button>
                <div
                  v-if="!visibleFocusedSkillItems.length && hiddenSkillCount === 0"
                  class="w-full rounded-xl border-2 border-dashed border-[#E2E6EF] bg-[linear-gradient(180deg,#FAFAFF_0%,#F6F4FF_100%)] px-5 py-6 text-center"
                >
                  <p class="text-sm font-medium text-gray-600">暂未配置技能</p>
                  <p class="mt-1 text-xs text-gray-400">先挂载常用技能，助手响应会更稳定</p>
                  <div class="mt-3">
                    <Button
                      variant="outline"
                      class="h-9 px-4 text-sm border-[#D2CCF4] text-[#5E4EF2] hover:bg-[#F4F1FF]"
                      @click="openFocusedAssistantConfig"
                    >
                      打开配置
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-[#E9E8F6] bg-[linear-gradient(180deg,rgba(249,249,255,0.95)_0%,rgba(245,246,255,0.92)_100%)] p-4">
              <div class="mb-3 text-sm font-semibold text-gray-800">工作空间</div>
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1 rounded-lg border border-[#E0E4EE] bg-white px-3.5 py-2 text-[14px] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]" :title="focusedAssistant.workspacePath || '~/Documents'">
                  {{ formatPath(focusedAssistant.workspacePath || '~/Documents') }}
                </div>
                <Button size="default" class="min-w-[116px]" @click="startFocusedAssistantSession">创建新会话</Button>
              </div>
            </section>
          </div>
        </div>
      </template>

      <template v-else-if="focusedAssistant">
        <div class="flex h-full w-full items-center justify-center overflow-y-auto px-8 py-8">
          <div class="mx-auto flex w-full max-w-[860px] flex-col gap-5">
            <section class="relative overflow-hidden rounded-2xl border border-[#ECEEF5] bg-[linear-gradient(135deg,#FFFFFF_0%,#F8F7FF_58%,#F0EDFF_100%)] p-5 shadow-sm">
              <div class="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(119,103,255,0.20),rgba(119,103,255,0))]" />
              <div class="flex items-start gap-4">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#F2EEFF,#E8E2FF)] ring-1 ring-[#DDD4FF]">
                  <img
                    v-if="focusedAssistantAvatar"
                    :src="focusedAssistantAvatar"
                    :alt="`${focusedAssistant.name} 头像`"
                    class="h-full w-full object-cover"
                  >
                  <UserRound v-else class="h-6 w-6 text-[#5B4EF2]" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-medium text-[#5B4EF2] ring-1 ring-[#D9D2FF]">
                    <Sparkles class="h-3.5 w-3.5" />
                    <span>个人助手</span>
                  </div>
                  <h2 class="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">{{ focusedAssistant.name }}</h2>
                  <p
                    class="mt-1.5 max-w-[640px] text-[13px] leading-6 text-gray-600 line-clamp-3"
                    :class="!personaExpanded && shouldCollapsePersona ? 'landing-profile-summary-clamp' : ''"
                  >
                    {{ focusedProfileSummary }}
                  </p>
                  <button
                    v-if="shouldCollapsePersona"
                    class="mt-1 text-xs font-medium text-[#5E4EF2] hover:underline"
                    @click="togglePersonaExpand"
                  >
                    {{ personaExpanded ? '收起' : '展开' }}
                  </button>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-[#ECEEF5] bg-white p-4 shadow-sm">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[15px] font-semibold text-gray-800">技能库收纳 (Skills)</div>
                <div class="text-xs text-gray-400">Skills</div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2.5">
                <button
                  v-for="skill in visibleFocusedSkillItems"
                  :key="skill.id"
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F1EEFF] px-3 text-xs text-[#5E4EF2] ring-1 ring-[#DDD6FF]"
                  @click="openFocusedAssistantConfig"
                >
                  <Bot class="h-3.5 w-3.5" />
                  <span>{{ skill.name }}</span>
                </button>
                <button
                  v-if="hiddenSkillCount > 0"
                  type="button"
                  class="inline-flex h-8 items-center rounded-full bg-[#EEF2FF] px-3 text-xs font-medium text-[#4C46E8] ring-1 ring-[#DDE3FF]"
                  @click="openFocusedAssistantConfig"
                >
                  + 查看全部配置 (剩余 {{ hiddenSkillCount }})
                </button>
                <div
                  v-if="!visibleFocusedSkillItems.length && hiddenSkillCount === 0"
                  class="w-full rounded-xl border-2 border-dashed border-[#E2E6EF] bg-[linear-gradient(180deg,#FAFAFF_0%,#F6F4FF_100%)] px-5 py-6 text-center"
                >
                  <p class="text-sm font-medium text-gray-600">暂未配置技能</p>
                  <p class="mt-1 text-xs text-gray-400">先挂载常用技能，助手响应会更稳定</p>
                  <div class="mt-3">
                    <Button
                      variant="outline"
                      class="h-9 px-4 text-sm border-[#D2CCF4] text-[#5E4EF2] hover:bg-[#F4F1FF]"
                      @click="openFocusedAssistantConfig"
                    >
                      打开配置
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-[#E9E8F6] bg-[linear-gradient(180deg,rgba(249,249,255,0.95)_0%,rgba(245,246,255,0.92)_100%)] p-4">
              <div class="mb-3 text-sm font-semibold text-gray-800">工作空间</div>
              <div class="flex items-end justify-between gap-3 max-[940px]:flex-col max-[940px]:items-stretch">
                <div class="min-w-0 flex-1">
                  <a-popover
                    v-model:open="workspacePopoverOpen"
                    trigger="click"
                    placement="topLeft"
                    overlay-class-name="ai-launch-workspace-popover"
                  >
                    <template #content>
                      <div class="w-[320px] rounded-[12px] bg-white p-2.5 shadow-[0_10px_22px_rgba(15,23,42,0.12)] ring-1 ring-[rgba(15,23,42,0.08)]">
                        <div class="space-y-1">
                          <button
                            v-for="path in workspacePopoverItems"
                            :key="path"
                            type="button"
                            class="flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[12px] transition-colors"
                            :class="path === landingWorkspacePath ? 'bg-[#EEF1FF] text-[#4F46E5]' : 'text-black/66 hover:bg-[#F6F8FF]'"
                            @click="selectWorkspaceFromPopover(path)"
                          >
                            <span class="truncate pr-2" :title="path">{{ formatPath(path) }}</span>
                            <Check v-if="path === landingWorkspacePath" class="h-3.5 w-3.5 shrink-0" />
                          </button>
                          <button
                            type="button"
                            class="flex w-full items-center rounded-[10px] px-2.5 py-2 text-[12px] text-[#4F46E5] transition-colors hover:bg-[#F3F5FF]"
                            @click="pickLandingWorkspace"
                          >
                            + 选择目录...
                          </button>
                        </div>
                      </div>
                    </template>
                    <button
                      type="button"
                      class="flex h-10 w-full items-center justify-between rounded-lg border border-[#E0E4EE] bg-white px-3 text-left text-[14px] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors hover:bg-[#FAFBFF]"
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <FolderOpen class="h-4 w-4 shrink-0 text-[#5E4EF2]" />
                        <span class="truncate" :title="landingWorkspacePath">{{ landingWorkspaceDisplay }}</span>
                      </div>
                      <ChevronDown class="h-4 w-4 shrink-0 text-black/38" />
                    </button>
                  </a-popover>
                </div>
                <Button size="default" class="min-w-[116px]" @click="handleLaunchPadStart">创建新会话</Button>
              </div>
            </section>
          </div>
        </div>
      </template>


      <template v-else>
        <div class="flex h-full w-full items-center justify-center text-[13px] text-black/36">
          {{ activeSessionLoading ? '正在切换会话...' : '请选择一个助手开始对话' }}
        </div>
      </template>
    </div>

    <NewAssistantModal
      v-if="showNewAssistant"
      :mode="assistantModalMode"
      :template-kind="assistantTemplateKind"
      :assistant="editingAssistant"
      :participant-candidates="newSessionParticipantCandidates"
      :readonly="isEditingBuiltin"
      @close="aiStudioStore.closeNewAssistant()"
      @submit="handleAssistantSubmit"
    />
    <InviteAssistantModal
      v-if="showInviteAssistant"
      @close="aiStudioStore.closeInviteAssistant()"
      @submit="aiStudioStore.inviteAssistants"
    />
  </div>
</template>

<style scoped>
:global(body.ai-assistant-preview .ant-message) {
  display: none !important;
}

:global(body.ai-assistant-preview) {
  --ai-font-caption: calc(var(--font-size-sm) * 1px);
  --ai-font-body: calc(var(--font-size) * 1px);
  --ai-font-label: calc(var(--font-size) * 1px);
  --ai-font-title: calc(var(--font-size-heading5) * 1px);
  --ai-font-page-title: 18px;
  --ai-leading-caption: var(--line-height-sm);
  --ai-leading-body: var(--line-height);
  --ai-leading-title: var(--line-height-heading5);
  --ai-leading-page-title: 1.35;
  --ai-line-soft: #edf1f8;
  --ai-line: #e4eaf5;
  --ai-line-strong: #d7e0ef;
  --ai-surface-soft: #f7f9fd;
  --ai-surface-soft-2: #f3f6fb;
}

.landing-profile-summary-clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

:global(.ai-launch-workspace-popover .ant-popover-inner) {
  padding: 0 !important;
  border-radius: 16px !important;
  overflow: hidden;
  background: transparent !important;
  box-shadow: none !important;
}

:global(.ai-launch-workspace-popover .ant-popover-inner-content) {
  padding: 0 !important;
}
</style>


