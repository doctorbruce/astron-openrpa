<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted } from 'vue'

import AutomationTaskView from './components/AutomationTaskView.vue'
import ArtifactPanel from './components/ArtifactPanel.vue'
import InviteAssistantModal from './components/InviteAssistantModal.vue'
import NewAssistantModal from './components/NewAssistantModal.vue'
import SettingsCenterView from './components/SettingsCenterView.vue'
import StudioChatPane from './components/StudioChatPane.vue'
import DiffuseLight from '@/components/Illustration/DiffuseLight.vue'
import { useAIStudioStore } from '@/stores/useAIStudioStore'

const aiStudioStore = useAIStudioStore()
const { activeSession, activeSessionLoading, activeSurface, assistantGroups, assistantModalMode, assistantTemplateKind, editingAssistant, invitedAssistants, isActiveSessionPending, isAiTyping, newSessionParticipantCandidates, sessionModelSelection, showInviteAssistant, showNewAssistant, workspaceOpen } = storeToRefs(aiStudioStore)
const assistantOptionCatalog = computed(() =>
  assistantGroups.value.flatMap(group => group.assistants.map(assistant => ({
    id: assistant.id,
    name: assistant.name,
    badge: assistant.badge,
    skillIds: assistant.skillIds || [],
    skills: assistant.skills || [],
    sessions: assistant.sessions,
  }))),
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
  (activeSessionAssistant.value?.skills || []).map((skill) => ({
    id: skill.name,
    label: skill.name,
    badge: skill.name.slice(0, 1).toUpperCase() || '技',
    description: skill.description || `当前助手已连接技能：${skill.name}`,
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
        badge: matched.badge || matched.name.slice(0, 1).toUpperCase() || '助',
        description: `提及 ${matched.name}`,
      }
    }

    return {
      id,
      label: id,
      badge: id.slice(0, 1).toUpperCase() || '助',
      description: `提及 ${id}`,
    }
  })
})
const isEditingBuiltin = computed(() => {
  return editingAssistant.value?.isBuiltin ?? false
})
onMounted(() => {
  document.body.classList.add('ai-assistant-preview')
})

onBeforeUnmount(() => {
  document.body.classList.remove('ai-assistant-preview')
})

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
    <div v-else class="relative z-10 h-full" />

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
</style>
