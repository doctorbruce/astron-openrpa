<script setup lang="ts">
import type { Component } from 'vue'
import { Clock, Code, Database, Puzzle, Search, Workflow } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'start-chat', topic: string): void
}>()

interface QuickActionCard {
  icon: Component
  title: string
  description: string
  topic: string
  gradient: string
}

const quickActions: QuickActionCard[] = [
  {
    icon: Workflow,
    title: '流程自动化',
    description: '帮我设计和优化业务流程自动化方案',
    topic: '流程自动化咨询',
    gradient: 'bg-gradient-to-br from-[#E8E6FF] to-[#F3F1FF]'
  },
  {
    icon: Database,
    title: '数据处理',
    description: '协助我进行数据采集、清洗和分析',
    topic: '数据处理帮助',
    gradient: 'bg-gradient-to-br from-[#E6F0FF] to-[#F0F5FF]'
  },
  {
    icon: Clock,
    title: '任务调度',
    description: '帮我规划和管理定时任务执行',
    topic: '任务调度配置',
    gradient: 'bg-gradient-to-br from-[#E6F7F5] to-[#F0FAF8]'
  },
  {
    icon: Code,
    title: '脚本开发',
    description: '指导我编写和调试自动化脚本',
    topic: '脚本开发指导',
    gradient: 'bg-gradient-to-br from-[#FFE6F0] to-[#FFF0F5]'
  },
  {
    icon: Puzzle,
    title: '系统集成',
    description: '帮我对接第三方系统和API接口',
    topic: '系统集成方案',
    gradient: 'bg-gradient-to-br from-[#FFF0E6] to-[#FFF5F0]'
  },
  {
    icon: Search,
    title: '问题诊断',
    description: '协助我排查和解决运行中的问题',
    topic: '问题诊断支持',
    gradient: 'bg-gradient-to-br from-[#E8EEFF] to-[#F0F3FF]'
  }
]
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center px-8 py-12">
    <!-- Header -->
    <div class="mb-8 text-center">
      <h2 class="mb-2 text-[20px] font-semibold text-black/84">
        你好，我是星小妙 👋
      </h2>
      <p class="text-[13px] text-black/54">
        星辰RPA官方智能助手，随时为你提供专业帮助
      </p>
    </div>

    <!-- 6 cards in 2 rows (3+3) -->
    <div class="grid w-full max-w-[900px] grid-cols-3 gap-4">
      <button
        v-for="action in quickActions"
        :key="action.title"
        class="group relative flex flex-col items-start gap-3 rounded-[16px] p-5 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_8px_24px_rgba(114,111,255,0.12)] focus:outline-none focus:ring-2 focus:ring-[#726FFF] focus:ring-offset-2"
        :class="action.gradient"
        :aria-label="`开始${action.title}对话`"
        :data-testid="`builtin-welcome-action-${action.topic}`"
        @click="emit('start-chat', action.topic)"
      >
        <!-- Icon circle -->
        <div class="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/40 backdrop-blur-sm transition-all duration-200 group-hover:bg-white/60">
          <component :is="action.icon" class="h-5 w-5 text-black/68" />
        </div>

        <!-- Title -->
        <h3 class="text-[14px] font-semibold text-black/84">
          {{ action.title }}
        </h3>

        <!-- Description -->
        <p class="text-[12px] leading-relaxed text-black/54">
          {{ action.description }}
        </p>
      </button>
    </div>
  </div>
</template>
