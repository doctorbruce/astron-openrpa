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

### 7. MCP 配置中心真实接入

- 设置中心里的 MCP 不再是前端 mock，改为真实读写桌面端设置
- 支持把 MCP 配置写入 sidecar runtime config 的 `mcp` 字段
- 接通 MCP 状态查询与手动连接 / 断开
- 断开后的 UI 状态从“未启用”修正为“已断开 / 可重连”
- 每次发消息前会实时读取一次 `GET /mcp`，把当前可用状态作为本轮 system 上下文补给 runtime，避免模型继续按旧印象回答“当前有哪些 MCP 服务”

相关文件：

- `frontend/packages/electron-app/src/shared/settings.ts`
- `frontend/packages/electron-app/src/main/store/settings-store.ts`
- `frontend/packages/electron-app/src/main/opencode/config.ts`
- `frontend/packages/electron-app/src/main/opencode/api.ts`
- `frontend/packages/electron-app/src/main/opencode/constants.ts`
- `frontend/packages/electron-app/src/main/opencode/workspace-context.ts`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/preload/index.ts`
- `frontend/packages/electron-app/src/preload/index.d.ts`
- `frontend/packages/web-app/src/types/opencode-api.d.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/SettingsCenterView.vue`

### 8. 流式打字与沉底体验

- `message.part.delta` 不再只触发整份 session 刷新，前端会直接把文本增量拼到当前 assistant 输出里
- 流式阶段的文本先按纯文本渲染，避免半截 markdown 在生成前期抖动、首行异常、后续又被最终结果覆盖
- 流式输出时聊天区会持续跟随沉底，不再只在开始生成时滚一次
- 最终仍保留 `message.updated / session.idle` 的整份对账刷新，保证和 runtime 最终结果一致

相关文件：

- `frontend/packages/web-app/src/stores/aiStudioStreaming.ts`
- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatCardRenderer.vue`
- `frontend/packages/web-app/src/views/AIStudio/types.ts`

### 9. Provider 配置改为“实例 + 模型列表”

- 供应商设置不再限制为“每家只存一条 + 一个模型”
- 标准供应商默认仍然只维护一个实例，但一个实例下可以保存多个模型，并单独指定该实例的默认模型
- `custom-openai-compatible` 改为支持多实例，每个实例独立保存显示名、Base URL、API Key 和模型列表
- 全局默认模型仍然指向具体的 `providerId + model`，只是这里的 `providerId` 现在是实例 ID
- runtime 配置生成时会按 provider 实例展开；`openai-compatible` 实例会把该实例下全部模型写入 `models`
- 已兼容旧设置文件：原来的 `model` 单字段会自动迁移成 `models[0]`

相关文件：

- `frontend/packages/electron-app/src/shared/settings.ts`
- `frontend/packages/electron-app/src/main/store/settings-store.ts`
- `frontend/packages/electron-app/src/main/opencode/config.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/SettingsCenterView.vue`

### 10. 会话级模型切换

- 聊天会话现在支持长期绑定自己的 `providerId + model`
- 生效优先级调整为：
  - 会话级覆盖
  - 助手默认模型
  - 全局默认模型
- 聊天头部新增会话模型下拉
  - 选项来自配置中心当前所有已保存模型
  - 支持“恢复默认”
  - 当前会话模型切换后会立即保存并在后续消息中真实生效
- 主进程发送消息时会打印实际解析出的 `providerId / model`，便于排查 runtime 是否真的切换

相关文件：

- `frontend/packages/electron-app/src/shared/settings.ts`
- `frontend/packages/electron-app/src/main/store/settings-store.ts`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/preload/index.ts`
- `frontend/packages/electron-app/src/preload/index.d.ts`
- `frontend/packages/web-app/src/stores/useAIStudioStore.ts`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`

### 11. 群聊入口、提及协作与成员冒泡

- 左侧栏正式区分 `我的助手` 与 `协作群聊`
- `新建群聊模板` 入口固定显示，不再要求先存在群聊
- 群聊侧栏项会显示群聊标识、真实成员组合头像和成员数量摘要
- 群聊 session detail 不再被错误识别成普通会话：
  - `mode: 'group'`
  - `participantAssistantIds`
  - `collaborationMode`
  都会真实透传到前端
- 群聊输入区的 `@提及` 已恢复为真实成员列表，不再只是 mock 按钮
- `mentions` 现在会从前端一路透传到主进程发送链路
- 主进程会把本轮被点名成员转成 coordinator 可理解的委派提示，驱动群聊优先把任务交给对应 `assistant-worker-*`
- 适配层现在会识别 `task` 工具结果里的 `<task_result>`，把它转成被点名成员自己的回复气泡
- 群聊里如果已经出现成员自己的回复，就不再额外渲染 coordinator 的“某某回复：...”转述腔

相关文件：

- `frontend/packages/web-app/src/views/AIStudio/components/AssistantSidebar.vue`
- `frontend/packages/web-app/src/views/AIStudio/components/StudioChatPane.vue`
- `frontend/packages/web-app/src/views/AIStudio/index.vue`
- `frontend/packages/web-app/src/views/AIStudio/providers/opencodeProvider.ts`
- `frontend/packages/electron-app/src/preload/index.ts`
- `frontend/packages/electron-app/src/preload/index.d.ts`
- `frontend/packages/electron-app/src/main/opencode-ipc.ts`
- `frontend/packages/electron-app/src/main/opencode/adapter.ts`
- `frontend/packages/electron-app/src/main/opencode/config.ts`
- `frontend/packages/electron-app/src/main/opencode/workspace-context.ts`

## 当前说明

- 这轮以功能打通与交互修正为主，没有系统性补跑整套测试
- 若后续要继续压性能，优先建议继续看：
  - runtime event 增量刷新
  - sidebar / chat pane 响应式拆分
  - workspace/artifact 面板按需加载
