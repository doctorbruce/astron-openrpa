<script setup lang="ts">
import type { Component } from 'vue'
import { Clock3, Code2, Database, Globe, Sparkles } from 'lucide-vue-next'

import xingxiaomiaoIpImage from '@/assets/img/ai-studio/xingxiaomiao-ip-cutout-clean.png'

const emit = defineEmits<{
  (e: 'start-chat', topic: string): void
}>()

interface QuickActionCard {
  icon: Component
  title: string
  description: string
  topic: string
  iconBg: string
  iconColor: string
}

const quickActions: QuickActionCard[] = [
  {
    icon: Globe,
    title: '网页自动化',
    description: '快速编排网页端采集、填报与批量操作流程。',
    topic: '请帮我规划一个网页自动化流程',
    iconBg: 'bg-[#EEF2FF]',
    iconColor: 'text-[#4F46E5]',
  },
  {
    icon: Clock3,
    title: '定时巡检',
    description: '配置定时任务，按计划执行检查并输出结果。',
    topic: '帮我设计一个定时巡检方案',
    iconBg: 'bg-[#E7F7F4]',
    iconColor: 'text-[#0F766E]',
  },
  {
    icon: Database,
    title: '数据处理',
    description: '整合数据采集、清洗、汇总与结果导出。',
    topic: '给我一个数据处理自动化思路',
    iconBg: 'bg-[#EAF2FF]',
    iconColor: 'text-[#1D4ED8]',
  },
  {
    icon: Code2,
    title: '脚本开发',
    description: '辅助生成、调试并完善自动化脚本与规则。',
    topic: '请帮我开始一个自动化脚本开发任务',
    iconBg: 'bg-[#FDECF3]',
    iconColor: 'text-[#BE185D]',
  },
]

function startNewSession() {
  emit('start-chat', '我想开始一个新的自动化任务，请先帮我梳理需求。')
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto px-8 py-8">
    <div class="mx-auto flex min-h-full w-full max-w-[1160px] flex-col justify-center gap-4">
      <section
        class="relative overflow-hidden rounded-[24px] border border-[rgba(99,102,241,0.12)] bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(246,246,255,0.96)_48%,rgba(252,244,255,0.95)_100%)] px-6 py-5 shadow-[0_10px_28px_rgba(99,102,241,0.08)]"
      >
        <div class="pointer-events-none absolute -left-16 -top-20 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(236,232,255,0.9)_0%,rgba(236,232,255,0)_72%)]" />
        <div class="pointer-events-none absolute -bottom-24 right-10 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,225,233,0.65)_0%,rgba(255,225,233,0)_74%)]" />
        <div class="relative flex items-center justify-between gap-6 max-[1040px]:flex-col max-[1040px]:items-start">
          <div class="min-w-0">
            <div class="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#6C63F1] ring-1 ring-[#DCD9FF]">
              <Sparkles class="h-3.5 w-3.5" />
              <span>官方助手</span>
            </div>
            <div class="mt-2.5 text-[28px] font-semibold leading-[1.2] tracking-[-0.01em] text-black/84">你好，我是星小妙</div>
            <p class="mt-2 max-w-[680px] text-[14px] leading-6 text-black/58">
              我可以帮你拆解目标、规划流程并持续跟进执行结果。点击下方场景卡片即可开始。
            </p>
          </div>
          <div class="shrink-0 self-end max-[1040px]:self-start">
            <div class="relative overflow-hidden rounded-[20px] p-1">
              <img
                :src="xingxiaomiaoIpImage"
                alt="星小妙IP形象"
                class="h-[198px] w-[198px] object-contain max-[1040px]:h-[164px] max-[1040px]:w-[164px]"
              >
            </div>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
        <button
          v-for="action in quickActions"
          :key="action.title"
          :data-testid="`builtin-welcome-action-${action.title}`"
          class="group relative flex min-h-[162px] flex-col rounded-[20px] bg-white/90 p-5 text-left ring-1 ring-[rgba(148,163,184,0.22)] transition-all duration-200 hover:-translate-y-[2px] hover:ring-[rgba(99,102,241,0.26)] hover:shadow-[0_10px_22px_rgba(99,102,241,0.12)]"
          @click="emit('start-chat', action.topic)"
        >
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-[12px]" :class="[action.iconBg, action.iconColor]">
              <component :is="action.icon" class="h-[18px] w-[18px]" />
            </div>
          </div>
          <div class="mt-4 text-[18px] font-semibold leading-7 text-black/84">{{ action.title }}</div>
          <p class="mt-1.5 text-[13px] leading-6 text-black/55">{{ action.description }}</p>
        </button>
      </section>

      <section class="flex items-center justify-center py-1">
        <button
          class="inline-flex h-10 items-center rounded-[12px] bg-[linear-gradient(135deg,#726FFF,#5D59FF)] px-6 text-[13px] font-semibold text-white shadow-[0_10px_20px_rgba(93,89,255,0.24)] transition-opacity hover:opacity-90"
          @click="startNewSession"
        >
          立即开始新会话
        </button>
      </section>
    </div>
  </div>
</template>
