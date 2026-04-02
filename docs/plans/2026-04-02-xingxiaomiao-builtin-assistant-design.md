# 星小妙·官方预置助手 设计文档

**日期**：2026-04-02
**状态**：已确认，待实现
**模块**：AI 工作室 (AIStudio)

---

## 背景

AI 工作室目前需要用户手动创建助手才能开始使用，对新用户不够友好。为此引入**星小妙**——星辰 RPA 平台的官方预置助手，代表平台官方能力入口，具备以下特征：

- 无需创建，开箱即用
- 内置系统人设，预置官方技能包（playwright、opencli 等 MCP）
- 不可被删除，不可被编辑（仅可只读查看配置）
- 初始无会话时展示精美欢迎引导页，帮助新用户快速上手

---

## 方案选择

采用**方案 B：后端返回预置助手**。

- 系统人设和技能包由后端维护，前端只负责渲染，后续可不发版调整内容
- "不可删除"约束在后端天然成立，前端识别标记后隐藏对应操作
- 欢迎引导和会话流程完全复用现有卡片体系和 provider 契约

---

## 数据模型扩展

### StudioAssistant 新增字段

```typescript
export interface StudioAssistant {
  // ...现有字段不变...
  isBuiltin?: boolean  // 标识官方预置助手，前端据此控制渲染差异
}
```

### Bootstrap 返回结构

后端 `getBootstrap()` 在 `assistantGroups` 第一位固定返回 `builtin` 分组：

```json
{
  "assistantGroups": [
    {
      "id": "builtin",
      "title": "官方助手",
      "assistants": [
        {
          "id": "__builtin_xingxiaomiao__",
          "name": "星小妙",
          "badge": "妙",
          "isBuiltin": true,
          "status": "idle",
          "skillIds": ["playwright", "opencli"],
          "sessions": []
        }
      ]
    },
    ...用户自建分组
  ],
  "defaultSessionId": "..."
}
```

---

## 侧边栏 (AssistantSidebar)

### 置顶渲染

- `builtin` group 的助手单独渲染在搜索框**上方**，不参与普通助手列表
- 新增 `PinnedAssistantCard` 组件，视觉上与下方用户助手列表用分隔线区分
- 卡片带品牌紫"官方"角标

### 操作限制

| 操作 | 行为 |
|------|------|
| 删除助手 | 隐藏，不展示 |
| 编辑助手 | 改为"查看助手"，Modal 内所有字段只读 |
| 新建会话 | 保留，与普通助手一致 |

### 搜索行为

- 星小妙的**会话**参与搜索
- 星小妙**本身**不参与助手搜索结果（避免与用户助手混淆）

---

## 欢迎引导页

**触发条件**：用户选中星小妙且该助手下无任何会话时，中央区渲染欢迎引导页。

### 布局

```
[星小妙头像 + 渐变背景装饰]

你好，我是星小妙 ✨
星辰 RPA 的官方助手，随时帮你自动化一切

[6 张快捷操作卡片，两行 3+3]

[「 开始对话 」按钮]
```

### 6 张快捷卡片规格

| # | 主题色 | 标题 | 副标题 | seedPrompt |
|---|--------|------|--------|------------|
| 1 | 紫色渐变 | 🌐 网页自动化 | 告诉我要访问哪个网站，我来帮你抓数据、填表、截图，一气呵成 | "我想自动化一个网页操作，" |
| 2 | 蓝绿渐变 | 📊 数据处理 | 扔给我一份 Excel，我帮你清洗、汇总、生成图表报告 | "我有一份数据需要处理，" |
| 3 | 橙金渐变 | 🤖 RPA 流程 | 描述你的重复性工作，我帮你一键生成自动化应用，解放双手 | "我想自动化这个重复性工作：" |
| 4 | 靛蓝渐变 | ⏰ 定时巡检 | 设定一个时间，我每天自动帮你跑报表、发邮件、监控系统状态 | "我想设置一个定时自动化任务，" |
| 5 | 墨绿渐变 | 🖥️ 桌面软件操控 | ERP、OA、SAP... 任何桌面软件都可以让我来代劳操作 | "我想自动化操作这个桌面软件：" |
| 6 | 玫瑰渐变 | 💡 不知从何开始？ | 告诉我你每天最烦的那件事，我来给你出一个自动化方案 | "我每天有一件很烦的事情，" |

### 卡片交互

- **Hover**：轻微上浮 + 投影加深 + 右下角出现"→ 试一试"
- **点击**：`createSession({ assistantId: '__builtin_xingxiaomiao__', seedPrompt })`，进入聊天后预填 seedPrompt

### 退出条件

星小妙有任何会话后，欢迎页不再出现，直接加载最近会话。

---

## 聊天区适配 (StudioChatPane)

### Header 差异

- 头像区使用星小妙专属样式：品牌紫渐变背景 + "妙"字徽章
- 隐藏"邀请助手"按钮（`isBuiltin` 助手不支持群聊邀请）
- 会话标题可重命名，与普通助手一致

### 输入区差异

- 技能选择器默认展示预置技能包，带"官方推荐"角标
- 附件、@提及等其余功能与普通助手一致

### 消息流

- 星小妙消息气泡头像使用专属样式
- Markdown 渲染、卡片交互、产物面板逻辑完全复用现有系统

---

## 数据流

```
App 启动
  └→ getBootstrap()
       └→ 返回 builtin group（含星小妙）+ 用户 groups
            └→ 前端检测 builtin group，PinnedAssistantCard 置顶渲染
                 └→ 星小妙无会话？
                      ├→ 是：渲染欢迎引导页（6 张卡片 + 开始对话按钮）
                      └→ 否：loadSessionDetail() 加载最近会话

用户点击快捷卡片 / 开始对话
  └→ createSession({ assistantId: '__builtin_xingxiaomiao__', seedPrompt? })
       └→ 后端以星小妙系统人设 + 技能包初始化会话
            └→ 走现有消息流、卡片流、产物流（零改动）
```

---

## 改动范围清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `types.ts` | 扩展 | `StudioAssistant` 新增 `isBuiltin` 字段 |
| `AssistantSidebar.vue` | 修改 | 识别 builtin group 置顶渲染，新增 `PinnedAssistantCard` 组件，隐藏删除、改编辑为只读 |
| `NewAssistantModal.vue` | 修改 | 支持只读模式（`isBuiltin` 时所有字段 disabled） |
| `StudioChatPane.vue` | 修改 | `isBuiltin` 时隐藏邀请按钮，技能选择器标注官方推荐 |
| `WelcomeView.vue` | 新增 | 欢迎引导页组件，含 6 张快捷卡片 |
| `useAIStudioStore.ts` | 微调 | `newSessionParticipantCandidates` 排除 builtin 助手 |

后端改动：`getBootstrap()` 返回固定的 builtin group，无需新增接口。
