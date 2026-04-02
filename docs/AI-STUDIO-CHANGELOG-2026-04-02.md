# AI-STUDIO 变更记录（2026-04-02）

## 本轮目标

围绕 `AI-STUDIO` 与 `opencode sidecar` 接入，优先修复以下问题：

- 会话映射异常导致旧会话消失
- AI 对话失败后界面一直卡在“正在思考”
- `/ 技能` 与技能权限、技能发现链路不一致
- 新建助手 / 新建会话交互过重
- 弹窗、侧栏、技能选择等交互卡顿

## 已完成改动

### 1. sidecar 与版本获取

- `fetch:opencode` 默认版本从 `v1.2.27` 提升到 `v1.3.13`
- 支持 `OPENCODE_SIDECAR_TAG=latest` 时走 GitHub `releases/latest`
- `frontend` 根目录已支持直接执行 `npm run fetch:opencode`

相关文件：

- `scripts/fetch-opencode-sidecar.mjs`
- `frontend/package.json`
- `docs/AI-STUDIO-OPENCODE-INTEGRATION.md`

### 2. 会话与侧栏稳定性

- 修复新建助手后旧会话“看起来消失”的问题
- 去掉 bootstrap 阶段危险的全局 cleanup
- 删除单个会话时改为精确解绑当前 session，不再影响其他助手
- 侧栏 active state 改为依赖 `activeSessionId`，减少全量重算

相关文件：

- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/main/store/assistant-store.ts`
- `frontend/packages/web-app/src/components/HomeContent.vue`
- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`

### 3. 对话错误态与停止能力

- 接住 `session.error` 事件，避免前端一直停留在 typing 状态
- 对话运行中增加“停止”按钮
- 接通 `abortSession` IPC 与 runtime `/abort`
- 顶部状态改为读取真实 session 状态

相关文件：

- `frontend/packages/electron-app/src/main/opencode/api.ts`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/main/store/session-store.ts`
- `frontend/packages/electron-app/src/shared/sessions.ts`
- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`

### 4. 技能选择与 runtime skill 链路

- `/ 技能` 发送时不再把 `<system-reminder>` 混进用户可见消息气泡
- 改为走独立 `system` 字段传给 runtime
- 助手侧栏 / 对话输入使用托管 skill 的真实 `name/description`
- 修复 `Available skills: none`
  - 原因是 `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` 同时禁掉了 `.agents/skills`
  - 现在通过 runtime 配置里的 `skills.paths` 显式注入 Astron 托管 skill 目录

相关文件：

- `frontend/packages/electron-app/src/main/index.ts`
- `frontend/packages/electron-app/src/main/opencode/config.ts`
- `frontend/packages/electron-app/src/main/opencode/adapter.ts`
- `frontend/packages/electron-app/src/main/opencode/constants.ts`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/preload/index.ts`
- `frontend/packages/electron-app/src/preload/index.d.ts`
- `frontend/packages/web-app/src/views/AIStudio/providers/opencodeProvider.ts`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`
- `frontend/packages/web-app/src/views/AIStudio/types.ts`
- `frontend/packages/web-app/src/types/opencode-api.d.ts`

### 5. 新建助手 / 新建会话交互

- 去掉“新建会话”弹窗链路
- 新建会话改为在侧栏点击后直接创建
- 工作空间改为在“新建助手 / 编辑助手”时配置
- 工作空间支持调用系统文件夹选择器
- 留空时仍走默认托管目录：
  - `AppData\\Roaming\\astron-rpa\\opencode\\workspaces\\assistants\\...`
  - `AppData\\Roaming\\astron-rpa\\opencode\\workspaces\\groups\\...`

相关文件：

- `frontend/packages/web-app/src/views/AIStudio/components/NewAssistantModal.vue`
- `frontend/packages/web-app/src/components/HomeContent.vue`
- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/preload/index.ts`

### 6. 交互与性能体感优化

- 减少 AI-STUDIO 首屏重复初始化
- 去掉发送消息后的立即全量 session 回拉
- 高频刷新不再每次都扫描 workspace
- 侧栏激活态与会话时间更新从整树重算改为局部更新
- modal 遮罩、blur、dropdown 与技能列表交互做过减负
- “正在思考”占位样式重做
- 发送后聊天区自动沉底

相关文件：

- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/providers/opencodeProvider.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`
- `frontend/packages/web-app/src/views/AIStudio/components/NewAssistantModal.vue`
- `frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`
- `frontend/packages/web-app/src/components/HomeContent.vue`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`

## 当前说明

- 这轮以功能打通与交互修正为主，没有系统性补跑整套测试
- 若后续要继续压性能，优先建议继续看：
  - runtime event 增量刷新
  - sidebar / chat pane 响应式拆分
  - workspace/artifact 面板按需加载
