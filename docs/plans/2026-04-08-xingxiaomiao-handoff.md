# 星小妙功能 Handoff 文档（2026-04-08）

> 上下文：本次开发在 `openrpa` 分支进行，基于设计文档 `2026-04-02-xingxiaomiao-builtin-assistant-design.md` 和实现计划 `2026-04-02-xingxiaomiao-implementation.md`。

---

## 已完成改动（按模块）

### 1. Web 类型与状态管理
**`frontend/packages/web-app/src/views/AIStudio/types.ts`**
- `StudioAssistant` 新增 `isBuiltin?: boolean` 字段。

**`frontend/packages/web-app/src/stores/useAIStudioStore.ts`**
- 新增 `focusedAssistantId: ref<string | null>(null)`。
- 新增 `showBuiltinWelcome: ref<boolean>(false)`。
- 新增 `signalBuiltinClicked()`：点击星小妙后设置 `showBuiltinWelcome = true`，并清空 `activeSessionId`。
- 新增 `startBuiltinChat(topic)`：为 builtin 助手创建会话，完成后清空 `showBuiltinWelcome`。
- `newSessionParticipantCandidates` 过滤掉 `isBuiltin` 助手（群聊候选不含星小妙）。
- `setActiveSession` 时清空 `showBuiltinWelcome`。

### 2. Web 交互与界面
**`frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`**
- `unifiedAssistants` 过滤 `group.id === 'builtin'`。
- `builtinAssistant` 从 `groups.find(g => g.id === 'builtin')` 读取。
- 顶部新增星小妙置顶卡片（渐变、角标、hover 动效、会话列表展开）。
- `defineEmits` 新增 `click-assistant` 与 `set-focused-assistant`。
- `focusAssistant()` 同时 emit 上述两个事件。

**`frontend/packages/web-app/src/components/HomeContent.vue`**
- `handleClickAssistant(assistantId)`：若为 builtin，则调用 `signalBuiltinClicked()`。
- `handleSetFocusedAssistant(assistantId)`：调用 `setFocusedAssistant()`。
- `<AIStudioSidebar>` 绑定 `@click-assistant` 和 `@set-focused-assistant`。

**`frontend/packages/web-app/src/views/AIStudio/components/BuiltinWelcomeView.vue`**（新建）
- 6 张快捷卡片（两行 3+3），每张独立色彩主题与 hover 动效。
- emit `start-chat(topic: string)`。

**`frontend/packages/web-app/src/views/AIStudio/index.vue`**
- 接入 `BuiltinWelcomeView`。
- 从 `storeToRefs` 读取 `showBuiltinWelcome`。
- 无 activeSession 时，按 `showBuiltinWelcome` 切换显示欢迎页或空态提示。
- 外层容器 class 按 `showBuiltinWelcome` 动态切换（铺满 vs 居中）。

**`frontend/packages/web-app/src/views/AIStudio/components/NewAssistantModal.vue`**
- 新增 `readonly` prop。
- 只读模式下禁用表单与技能列表，操作栏改为单个“关闭”按钮，标题显示“查看助手”。

### 3. Electron 主进程 builtin seed
**`frontend/packages/electron-app/src/main/store/assistant-store.ts`**
- `AssistantStore` 接口新增 `ensureAssistant(id, input)`。
- 实现为幂等写入：不存在则插入，存在则直接返回。

**`frontend/packages/electron-app/src/main/opencode/adapter.ts`**
- 导出常量 `BUILTIN_ASSISTANT_ID = '__builtin_xingxiaomiao__'`。
- 本地 `StudioAssistant` 类型新增 `isBuiltin?: boolean`。
- `toStudioAssistantGroups` 识别 builtin ID，拆分出单独 `id: 'builtin'` group，并设置 `isBuiltin: true`。

**`frontend/packages/electron-app/src/main/index.ts`**
- 引入 `BUILTIN_ASSISTANT_ID`。
- 在 `ready()` 中调用 `assistantStore.ensureAssistant(...)`，确保窗口打开前完成 seed。

---

## 当前待提交状态（工作区）

截至 2026-04-08，以下文件仍为本地改动或未跟踪，尚未 commit：
- `frontend/packages/electron-app/src/main/store/assistant-store.ts`
- `frontend/packages/electron-app/src/main/opencode/adapter.ts`
- `frontend/packages/electron-app/src/main/index.ts`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`
- `docs/plans/2026-04-08-xingxiaomiao-handoff.md`（本文档，未跟踪）

由于 Electron 三个主进程文件尚未提交，当前运行版本可能仍不会返回 `builtin` group，进而导致：
- 星小妙不出现在侧边栏。
- `startBuiltinChat` 因找不到 builtin 助手而失败。

---

## 建议提交步骤（PowerShell）

```powershell
cd C:\Users\wjcai5\Desktop\Projects\astron-openrpa
git add frontend/packages/electron-app/src/main/store/assistant-store.ts
git add frontend/packages/electron-app/src/main/opencode/adapter.ts
git add frontend/packages/electron-app/src/main/index.ts
git add frontend/packages/web-app/src/views/AIStudio/index.vue
git add docs/plans/2026-04-08-xingxiaomiao-handoff.md
git commit -m "fix(ai-studio): seed builtin assistant and wire welcome view"
```

提交后需要**完全重启 Electron app**（热重载不会重新执行 `ready()`，无法触发 seed）。

---

## 首次 seed 验证清单

- [ ] 侧边栏顶部出现星小妙置顶卡片（渐变 + 角标）。
- [ ] 点击星小妙卡片后，中间区域显示 `BuiltinWelcomeView` 的 6 张快捷卡片。
- [ ] 点击任意快捷卡片后，能创建会话并跳转聊天界面。
- [ ] 点击星小妙“新建会话”（`+` 图标）可直接创建会话。
- [ ] 点击“查看助手”（眼睛图标）可打开只读模式 `NewAssistantModal`。
- [ ] 群聊新建时，候选助手列表不含星小妙。
- [ ] 切到其他助手会话后，再点击星小妙会重新显示引导页（不是直接进会话）。

---

## Git Bash 说明

若仍出现 `fatal error - add_item ("\??\D:\Program Files\Git", ...)`：
- 优先用 PowerShell 或 CMD 执行 git 命令。
- 或使用 VS Code Source Control 面板完成提交。
