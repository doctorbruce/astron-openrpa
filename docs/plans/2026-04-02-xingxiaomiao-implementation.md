# 星小妙官方预置助手 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 AI 工作室侧边栏置顶渲染官方预置助手"星小妙"，不可删除、不可编辑（只读），无会话时展示精美欢迎引导页，有会话时与普通助手体验一致。

**Architecture:** 后端在 `getBootstrap()` 返回的 `assistantGroups` 中固定注入 `builtin` 分组，前端识别 `isBuiltin: true` 标记后在侧边栏置顶渲染，同时限制删除/编辑操作。欢迎引导页作为独立组件 `BuiltinWelcomeView.vue`，在星小妙无会话时由 `index.vue` 渲染。

**Tech Stack:** Vue 3 Composition API, TypeScript, Tailwind CSS (arbitrary values), Pinia, lucide-vue-next

---

## Task 1: 扩展类型定义

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/types.ts:27-41`

**Step 1: 在 StudioAssistant 接口添加 isBuiltin 字段**

```typescript
export interface StudioAssistant {
  id: string
  name: string
  badge: string
  status: string
  tag?: string
  workspacePath?: string
  persona?: string
  capabilities?: string
  skillIds?: string[]
  skills?: StudioAssistantSkill[]
  groupParticipantAssistantIds?: string[]
  groupCollaborationMode?: StudioCollaborationMode
  sessions: StudioSession[]
  isBuiltin?: boolean  // 新增：标识官方预置助手
}
```

**Step 2: 验证 TypeScript 无报错**

在项目根目录运行：
```bash
cd frontend && npx tsc --noEmit
```
Expected: 无错误输出

**Step 3: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/types.ts
git commit -m "feat(ai-studio): add isBuiltin field to StudioAssistant type"
```

---

## Task 2: Store 排除 builtin 助手出群聊候选列表

**Files:**
- Modify: `frontend/packages/web-app/src/stores/useAIStudioStore.ts:113-120`

**Step 1: 修改 newSessionParticipantCandidates computed**

当前代码（113-120行）：
```typescript
const newSessionParticipantCandidates = computed(() => {
  const singleGroup = assistantGroups.value.find(group => group.id === 'single')
  return (singleGroup?.assistants || []).map(assistant => ({
    id: assistant.id,
    name: assistant.name,
    badge: assistant.badge,
  }))
})
```

改为：
```typescript
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
```

**Step 2: Commit**

```bash
git add frontend/packages/web-app/src/stores/useAIStudioStore.ts
git commit -m "feat(ai-studio): exclude builtin assistant from group participant candidates"
```

---

## Task 3: 侧边栏提取 builtin 助手并置顶

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`

**Step 1: 在 script 中新增 builtinAssistant computed**

在 `unifiedAssistants` computed 之后（约第54行后）添加：

```typescript
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
```

**Step 2: 修改 unifiedAssistants，排除 builtin group**

当前（约第46-54行）：
```typescript
const unifiedAssistants = computed<SidebarAssistantEntry[]>(() =>
  props.groups.flatMap(group =>
    group.assistants.map(assistant => ({
      ...assistant,
      groupId: group.id,
      isCollaboration: group.id === 'collaboration',
    })),
  ),
)
```

改为：
```typescript
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
```

**Step 3: 在 template 搜索框上方添加星小妙置顶卡片**

在 `<div ref="createMenuAnchorRef"` 块之后、搜索框 `<div class="relative mb-3 ...">` 之前，插入：

```html
<!-- 星小妙置顶卡片 -->
<div v-if="builtinAssistant" class="px-3 pb-2 pt-1">
  <div
    :data-testid="`assistant-shell-${builtinAssistant.id}`"
    class="group/builtin relative cursor-pointer overflow-hidden rounded-[16px] bg-[linear-gradient(135deg,rgba(114,111,255,0.10),rgba(93,89,255,0.06))] ring-1 ring-[rgba(114,111,255,0.14)] transition-all duration-150"
    :class="builtinAssistant.id === focusedAssistantId
      ? 'bg-[linear-gradient(135deg,rgba(114,111,255,0.16),rgba(93,89,255,0.10))] ring-[rgba(114,111,255,0.24)] shadow-[0_6px_18px_rgba(114,111,255,0.12)]'
      : 'hover:bg-[linear-gradient(135deg,rgba(114,111,255,0.13),rgba(93,89,255,0.08))] hover:ring-[rgba(114,111,255,0.18)]'"
    @click="focusAssistant(builtinAssistant.id)"
  >
    <div class="flex items-center gap-2.5 px-3 py-2.5">
      <!-- 头像 -->
      <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] shadow-[0_4px_12px_rgba(114,111,255,0.30)]">
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
          <span class="shrink-0 rounded-full bg-[rgba(114,111,255,0.12)] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#726FFF]">官方</span>
        </div>
        <span class="mt-0.5 block truncate text-[11px] leading-[16px] text-black/42">万能助手 · 开箱即用</span>
      </div>

      <!-- 新建会话按钮 -->
      <button
        :data-testid="`assistant-new-session-trigger-${builtinAssistant.id}`"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(114,111,255,0.10)] text-[#716DF8] transition-colors hover:bg-[rgba(114,111,255,0.18)] opacity-0 group-hover/builtin:opacity-100"
        :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : ''"
        title="新建会话"
        @click.stop="emit('open-new-session', builtinAssistant.id)"
      >
        <Plus class="h-3.5 w-3.5" />
      </button>

      <!-- 只读查看按钮 -->
      <button
        :data-testid="`assistant-view-trigger-${builtinAssistant.id}`"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white/60 text-black/36 transition-colors hover:bg-white/90 opacity-0 group-hover/builtin:opacity-100"
        :class="builtinAssistant.id === focusedAssistantId ? 'opacity-100' : ''"
        title="查看助手"
        @click.stop="emit('open-edit-assistant', builtinAssistant.id)"
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
        class="group/session relative flex items-center gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-150 cursor-pointer"
        :class="session.id === activeSessionId
          ? 'bg-[rgba(114,111,255,0.10)] text-[#4F4BCC]'
          : 'text-black/54 hover:bg-[rgba(114,111,255,0.06)] hover:text-black/72'"
        @click.stop="emit('select-session', builtinAssistant.id, session.id)"
      >
        <span
          v-if="session.id === activeSessionId"
          class="h-1.5 w-1.5 shrink-0 rounded-full bg-[#726FFF]"
        />
        <span class="min-w-0 flex-1 truncate text-[11px] font-medium leading-[18px]">{{ session.title }}</span>
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
```

**Step 4: 在 imports 中添加 Eye 图标**

将第2行：
```typescript
import { MoreHorizontal, Pencil, Plus, Search, Settings, Trash2, Users, Zap } from 'lucide-vue-next'
```
改为：
```typescript
import { Eye, MoreHorizontal, Pencil, Plus, Search, Settings, Trash2, Users, Zap } from 'lucide-vue-next'
```

**Step 5: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue
git commit -m "feat(ai-studio): add pinned builtin assistant card to sidebar"
```

---

## Task 4: NewAssistantModal 支持只读模式

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/components/NewAssistantModal.vue`

**Step 1: 新增 readonly prop**

在 `props = withDefaults(defineProps<{...}>(), {...})` 中新增：

```typescript
const props = withDefaults(defineProps<{
  mode?: 'create' | 'edit'
  readonly?: boolean          // 新增：只读模式（isBuiltin 助手查看时使用）
  assistant?: StudioAssistant | null
  templateKind?: 'assistant' | 'group'
  participantCandidates?: SessionParticipantCandidate[]
}>(), {
  mode: 'create',
  readonly: false,            // 新增默认值
  assistant: null,
  templateKind: 'assistant',
  participantCandidates: () => [],
})
```

**Step 2: 修改 modalTitle 和 submitLabel computed**

```typescript
const modalTitle = computed(() => {
  if (props.readonly)
    return '查看 AI 助手'
  if (isGroupTemplate.value)
    return isEditMode.value ? '编辑群聊模板' : '新建群聊模板'
  return isEditMode.value ? '编辑 AI 助手模板' : '新建 AI 助手模板'
})
```

**Step 3: 在 template 中所有 Input/Textarea 上添加 :disabled="props.readonly"**

找到所有表单输入字段（name、workspacePath、persona、capabilities），统一加上 `:disabled="props.readonly"` 和 `class` 追加 `disabled:opacity-60 disabled:cursor-not-allowed`。

技能列表的勾选 checkbox 同样加 `:disabled="props.readonly"`。

**Step 4: 只读模式时隐藏 ModalActionBar 的提交按钮**

在 `<ModalActionBar>` 外包裹条件或传 prop：
```html
<ModalActionBar
  v-if="!props.readonly"
  :disabled="!canSubmit"
  :label="submitLabel"
  @cancel="emit('close')"
  @submit="handleSubmit"
/>
<div v-else class="flex justify-end px-6 pb-5 pt-3">
  <button
    class="rounded-[12px] bg-[rgba(114,111,255,0.08)] px-4 py-2 text-[13px] font-medium text-[#726FFF] transition-colors hover:bg-[rgba(114,111,255,0.14)]"
    @click="emit('close')"
  >
    关闭
  </button>
</div>
```

**Step 5: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/components/NewAssistantModal.vue
git commit -m "feat(ai-studio): add readonly mode to NewAssistantModal for builtin assistant"
```

---

## Task 5: index.vue 传 readonly prop 给 NewAssistantModal

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/index.vue`

**Step 1: 从 store 获取 editingAssistant 是否 isBuiltin**

在 `storeToRefs` 取出的变量之后，添加：
```typescript
const isEditingBuiltin = computed(() => editingAssistant.value?.isBuiltin === true)
```

**Step 2: 给 NewAssistantModal 传 readonly**

```html
<NewAssistantModal
  v-if="showNewAssistant"
  :mode="assistantModalMode"
  :readonly="isEditingBuiltin"
  :template-kind="assistantTemplateKind"
  :assistant="editingAssistant"
  :participant-candidates="newSessionParticipantCandidates"
  @close="aiStudioStore.closeNewAssistant()"
  @submit="handleAssistantSubmit"
/>
```

**Step 3: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/index.vue
git commit -m "feat(ai-studio): pass readonly to NewAssistantModal when editing builtin assistant"
```

---

## Task 6: 新建欢迎引导页组件 BuiltinWelcomeView.vue

**Files:**
- Create: `frontend/packages/web-app/src/views/AIStudio/components/BuiltinWelcomeView.vue`

**Step 1: 创建组件文件**

```vue
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'start-chat', seedPrompt?: string): void
}>()

interface QuickCard {
  emoji: string
  title: string
  description: string
  seedPrompt: string
  gradient: string
  iconBg: string
  titleColor: string
}

const quickCards: QuickCard[] = [
  {
    emoji: '🌐',
    title: '网页自动化',
    description: '告诉我要访问哪个网站，我来帮你抓数据、填表、截图，一气呵成',
    seedPrompt: '我想自动化一个网页操作，',
    gradient: 'linear-gradient(135deg, rgba(114,111,255,0.10) 0%, rgba(93,89,255,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#726FFF,#5D59FF)]',
    titleColor: 'text-[#4F4BCC]',
  },
  {
    emoji: '📊',
    title: '数据处理',
    description: '扔给我一份 Excel，我帮你清洗、汇总、生成图表报告',
    seedPrompt: '我有一份数据需要处理，',
    gradient: 'linear-gradient(135deg, rgba(20,184,166,0.10) 0%, rgba(6,182,212,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#14B8A6,#06B6D4)]',
    titleColor: 'text-[#0D7A72]',
  },
  {
    emoji: '🤖',
    title: 'RPA 流程',
    description: '描述你的重复性工作，我帮你一键生成自动化应用，解放双手',
    seedPrompt: '我想自动化这个重复性工作：',
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(251,146,60,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#F59E0B,#FB923C)]',
    titleColor: 'text-[#92400E]',
  },
  {
    emoji: '⏰',
    title: '定时巡检',
    description: '设定一个时间，我每天自动帮你跑报表、发邮件、监控系统状态',
    seedPrompt: '我想设置一个定时自动化任务，',
    gradient: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(79,70,229,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#6366F1,#4F46E5)]',
    titleColor: 'text-[#3730A3]',
  },
  {
    emoji: '🖥️',
    title: '桌面软件操控',
    description: 'ERP、OA、SAP... 任何桌面软件都可以让我来代劳操作',
    seedPrompt: '我想自动化操作这个桌面软件：',
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, rgba(5,150,105,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#10B981,#059669)]',
    titleColor: 'text-[#065F46]',
  },
  {
    emoji: '💡',
    title: '不知从何开始？',
    description: '告诉我你每天最烦的那件事，我来给你出一个自动化方案',
    seedPrompt: '我每天有一件很烦的事情，',
    gradient: 'linear-gradient(135deg, rgba(244,63,94,0.10) 0%, rgba(236,72,153,0.05) 100%)',
    iconBg: 'bg-[linear-gradient(135deg,#F43F5E,#EC4899)]',
    titleColor: 'text-[#9F1239]',
  },
]
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-10">
    <!-- 顶部头像和问候 -->
    <div class="mb-8 flex flex-col items-center text-center">
      <div class="relative mb-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] shadow-[0_12px_32px_rgba(114,111,255,0.32)]">
          <span class="text-[24px] font-bold text-white">妙</span>
        </div>
        <div class="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#726FFF] ring-2 ring-white shadow-md">
          <Sparkles class="h-3 w-3 text-white" />
        </div>
      </div>
      <h2 class="mb-1.5 text-[20px] font-bold leading-tight text-black/84">
        你好，我是星小妙 ✨
      </h2>
      <p class="max-w-[320px] text-[13px] leading-[20px] text-black/46">
        星辰 RPA 的官方助手，随时帮你自动化一切
      </p>
    </div>

    <!-- 6 张快捷卡片，两行 3+3 -->
    <div class="mb-8 grid w-full max-w-[680px] grid-cols-3 gap-3">
      <button
        v-for="card in quickCards"
        :key="card.title"
        class="group relative flex flex-col items-start overflow-hidden rounded-[18px] p-4 text-left ring-1 ring-black/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] hover:ring-black/[0.09]"
        :style="{ background: card.gradient }"
        @click="emit('start-chat', card.seedPrompt)"
      >
        <!-- 图标 -->
        <div
          class="mb-3 flex h-9 w-9 items-center justify-center rounded-[12px] shadow-[0_4px_10px_rgba(0,0,0,0.12)]"
          :class="card.iconBg"
        >
          <span class="text-[18px] leading-none">{{ card.emoji }}</span>
        </div>

        <!-- 标题 -->
        <div
          class="mb-1.5 text-[13px] font-semibold leading-tight"
          :class="card.titleColor"
        >
          {{ card.title }}
        </div>

        <!-- 描述 -->
        <p class="text-[11px] leading-[17px] text-black/46">
          {{ card.description }}
        </p>

        <!-- Hover 箭头 -->
        <div class="absolute bottom-3.5 right-3.5 translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
          <span class="text-[11px] font-medium text-black/36">→ 试一试</span>
        </div>
      </button>
    </div>

    <!-- 开始对话按钮 -->
    <button
      class="h-10 rounded-[14px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] px-8 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(114,111,255,0.24)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(114,111,255,0.32)]"
      @click="emit('start-chat')"
    >
      开始对话
    </button>
  </div>
</template>
```

**Step 2: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/components/BuiltinWelcomeView.vue
git commit -m "feat(ai-studio): add BuiltinWelcomeView with 6 quick action cards"
```

---

## Task 7: 在 index.vue 中接入欢迎引导页

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/index.vue`

**Step 1: import BuiltinWelcomeView**

在现有 import 区域添加：
```typescript
import BuiltinWelcomeView from './components/BuiltinWelcomeView.vue'
```

**Step 2: 新增 computed 判断是否展示欢迎页**

在 `composerMentionOptions` computed 之后添加：
```typescript
const activeSessionAssistantIsBuiltin = computed(() =>
  activeSessionAssistant.value?.isBuiltin === true
    || assistantGroups.value
      .find(g => g.id === 'builtin')
      ?.assistants.some(a => a.id === aiStudioStore.focusedBuiltinAssistantId) === true,
)

const showBuiltinWelcome = computed(() => {
  // 当前选中的是 builtin 助手且没有 activeSession
  const builtinGroup = assistantGroups.value.find(g => g.id === 'builtin')
  if (!builtinGroup?.assistants.length)
    return false
  const builtinAssistant = builtinGroup.assistants[0]
  return builtinAssistant.sessions.length === 0
    && aiStudioStore.focusedAssistantId === builtinAssistant.id
})
```

> 注意：`focusedAssistantId` 需要从 store 暴露出来（见 Task 8）。

**Step 3: 修改 template，在 activeSession 不存在时增加欢迎页分支**

把现有的：
```html
<div
  v-else
  class="flex h-full items-center justify-center text-sm text-black/42"
>
  {{ activeSessionLoading ? '正在切换会话...' : 'AI 助手页面正在初始化...' }}
</div>
```

改为：
```html
<template v-else-if="showBuiltinWelcome">
  <BuiltinWelcomeView
    class="relative z-10 flex-1"
    @start-chat="aiStudioStore.startBuiltinChat($event)"
  />
</template>
<div
  v-else
  class="flex h-full items-center justify-center text-sm text-black/42"
>
  {{ activeSessionLoading ? '正在切换会话...' : 'AI 助手页面正在初始化...' }}
</div>
```

**Step 4: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/index.vue
git commit -m "feat(ai-studio): integrate BuiltinWelcomeView into index.vue"
```

---

## Task 8: Store 暴露 focusedAssistantId 并新增 startBuiltinChat action

**Files:**
- Modify: `frontend/packages/web-app/src/stores/useAIStudioStore.ts`

**Step 1: 确认 focusedAssistantId 在 store 中存在**

目前 `focusedAssistantId` 是 `AssistantSidebar` 组件的本地状态，store 层没有。需要将侧边栏的"当前聚焦助手"状态提升到 store。

在 store refs 区域（约第86-101行）添加：
```typescript
const focusedAssistantId = ref('')
```

在 store return 中暴露：
```typescript
return {
  // ...现有暴露...
  focusedAssistantId,
  // ...
}
```

**Step 2: 新增 setFocusedAssistant action**

```typescript
function setFocusedAssistant(assistantId: string) {
  focusedAssistantId.value = assistantId
}
```

**Step 3: 新增 startBuiltinChat action**

```typescript
async function startBuiltinChat(seedPrompt?: string) {
  const builtinGroup = assistantGroups.value.find(g => g.id === 'builtin')
  const builtinAssistant = builtinGroup?.assistants[0]
  if (!builtinAssistant)
    return

  await createSession({
    assistantId: builtinAssistant.id,
    title: seedPrompt ? seedPrompt.slice(0, 20) : '新对话',
    seedPrompt,
  })
}
```

**Step 4: 在 return 中暴露新增内容**

```typescript
return {
  // ...现有...
  focusedAssistantId,
  setFocusedAssistant,
  startBuiltinChat,
}
```

**Step 5: Commit**

```bash
git add frontend/packages/web-app/src/stores/useAIStudioStore.ts
git commit -m "feat(ai-studio): add focusedAssistantId and startBuiltinChat to store"
```

---

## Task 9: AssistantSidebar 改用 store 的 focusedAssistantId

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`

**Step 1: 在 AssistantSidebar 新增 emit setFocusedAssistant**

```typescript
const emit = defineEmits<{
  // ...现有 emit...
  (e: 'set-focused-assistant', assistantId: string): void
}>()
```

**Step 2: 将 focusAssistant 函数改为 emit 事件**

```typescript
function focusAssistant(assistantId: string) {
  confirmingAssistantDeleteId.value = null
  emit('set-focused-assistant', assistantId)
}
```

**Step 3: 将 focusedAssistantId prop 从 props 接收**

```typescript
const props = defineProps<{
  groups: StudioAssistantGroup[]
  activeSessionId: string
  focusedAssistantId: string           // 新增
  activeSurface?: 'main' | 'automation' | 'settings'
}>()
```

并删除本地 `const focusedAssistantId = ref('')`，改为直接引用 `props.focusedAssistantId`。

**Step 4: 在 index.vue 中传入并处理**

在 index.vue 中的 `<AssistantSidebar>` 标签添加：
```html
<AssistantSidebar
  ...
  :focused-assistant-id="aiStudioStore.focusedAssistantId"
  @set-focused-assistant="aiStudioStore.setFocusedAssistant($event)"
/>
```

**Step 5: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue
git add frontend/packages/web-app/src/views/AIStudio/index.vue
git commit -m "refactor(ai-studio): lift focusedAssistantId to store"
```

---

## Task 10: StudioChatPane 隐藏 builtin 助手的邀请按钮

**Files:**
- Modify: `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`
- Modify: `frontend/packages/web-app/src/views/AIStudio/index.vue`

**Step 1: 在 StudioChatPane 新增 isBuiltin prop**

```typescript
const props = defineProps<{
  session: StudioSessionDetail
  workspaceOpen: boolean
  invitedAssistants: string[]
  availableSkills: ComposerSkillOption[]
  mentionOptions: ComposerMentionOption[]
  sessionPending: boolean
  isAiTyping?: boolean
  isBuiltin?: boolean          // 新增
  isCardPending: (cardId: string) => boolean
  isActionPending: (actionId: string) => boolean
}>()
```

**Step 2: 找到"邀请助手"按钮，添加 v-if**

在 template 中搜索 `open-invite` 相关按钮（含 `UserPlus` 图标），添加：
```html
<button
  v-if="!props.isBuiltin"
  ...邀请按钮现有内容...
>
```

**Step 3: 技能选择器官方推荐角标**

找到技能选择器下拉项的渲染处（搜索 `skillOptions` 或 `availableSkills`），在每个技能 badge 旁添加：
```html
<span
  v-if="props.isBuiltin"
  class="ml-auto shrink-0 rounded-full bg-[rgba(114,111,255,0.10)] px-1.5 py-0.5 text-[9px] font-semibold text-[#726FFF]"
>官方推荐</span>
```

**Step 4: index.vue 传入 isBuiltin**

```typescript
const activeSessionAssistantIsBuiltin = computed(() =>
  activeSessionAssistant.value?.isBuiltin === true,
)
```

```html
<StudioChatPane
  ...
  :is-builtin="activeSessionAssistantIsBuiltin"
  ...
/>
```

（两处 StudioChatPane 都需要加，包括 settings 视图下的模糊背景那个）

**Step 5: Commit**

```bash
git add frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue
git add frontend/packages/web-app/src/views/AIStudio/index.vue
git commit -m "feat(ai-studio): hide invite button and add official skill badge for builtin assistant"
```

---

## Task 11: 端到端验收

**手动验收清单：**

1. **置顶卡片**
   - [ ] 启动应用，侧边栏顶部出现"星小妙"卡片，有"官方"角标
   - [ ] 普通助手列表在分隔线下方，互不影响

2. **欢迎引导页**
   - [ ] 星小妙无会话时，中央区显示欢迎页，含 6 张卡片和"开始对话"按钮
   - [ ] 点击任意卡片，自动创建会话并进入聊天，input 框预填对应文字
   - [ ] 点击"开始对话"，创建空白会话进入聊天
   - [ ] 有会话后再次切换到星小妙，不再出现欢迎页

3. **操作限制**
   - [ ] hover 星小妙卡片，出现新建会话 + 查看助手按钮，无删除按钮
   - [ ] 点击"查看助手"，打开 Modal，所有字段灰化不可编辑，只有"关闭"按钮

4. **聊天体验**
   - [ ] 星小妙会话中，顶部无"邀请助手"按钮
   - [ ] 技能选择器中每项有"官方推荐"角标
   - [ ] 普通助手不受影响

5. **群聊候选**
   - [ ] 新建群聊时，候选助手列表中不出现星小妙
