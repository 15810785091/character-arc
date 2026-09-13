<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Circle, CircleAlert, LoaderCircle, Pause, Play, Square } from 'lucide-vue-next'
import { NButton, NModal, NProgress, NTag } from 'naive-ui'

export type ChapterBatchDraftItem = {
  chapterId: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error?: string
}

const props = defineProps<{
  show: boolean
  items: ChapterBatchDraftItem[]
  isRunning: boolean
  isPaused: boolean
  pauseRequested: boolean
  progressPercent: number
  progressText: string
  executionLabel: string
}>()

const emit = defineEmits<{
  close: []
  pause: []
  resume: []
  stop: []
}>()

const completedCount = computed(() => props.items.filter((item) => item.status === 'completed').length)
const currentItem = computed(() => props.items.find((item) => item.status === 'running'))
const allComplete = computed(() => props.items.length > 0 && completedCount.value === props.items.length)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="批量生成章节初稿"
    :style="{ width: 'min(720px, 94vw)' }"
    :bordered="false"
    :mask-closable="!isRunning"
    :closable="!isRunning"
    @close="emit('close')"
  >
    <div class="batch-draft-layout">
      <div class="batch-summary">
        <div>
          <strong>{{ completedCount }} / {{ items.length }} 章已完成</strong>
          <span v-if="currentItem">正在创作《{{ currentItem.title }}》</span>
          <span v-else-if="allComplete">全部章节已经生成并保存</span>
          <span v-else-if="isPaused">队列已暂停，可从未完成章节继续</span>
          <span v-else>等待开始</span>
        </div>
        <NTag v-if="pauseRequested && isRunning" type="warning" :bordered="false">本章完成后暂停</NTag>
        <NTag v-else-if="isPaused" type="warning" :bordered="false">已暂停</NTag>
        <NTag v-else-if="allComplete" type="success" :bordered="false">已完成</NTag>
        <NTag v-else-if="isRunning" type="info" :bordered="false">生成中</NTag>
      </div>

      <div v-if="currentItem" class="current-progress">
        <NProgress type="line" :percentage="progressPercent" :show-indicator="false" />
        <span>{{ progressText || executionLabel || '正在准备章节上下文…' }}</span>
      </div>

      <div class="batch-items arc-scrollbar">
        <div v-for="item in items" :key="item.chapterId" class="batch-item">
          <LoaderCircle v-if="item.status === 'running'" :size="16" class="spinning running" />
          <CheckCircle2 v-else-if="item.status === 'completed'" :size="16" class="completed" />
          <CircleAlert v-else-if="item.status === 'failed'" :size="16" class="failed" />
          <Circle v-else :size="16" class="pending" />
          <div>
            <strong>{{ item.title }}</strong>
            <span v-if="item.error">{{ item.error }}</span>
            <span v-else>{{ item.status === 'completed' ? '正文已保存' : item.status === 'running' ? '正在执行统一初稿流程' : '等待生成' }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <NButton v-if="!isRunning && !allComplete" type="primary" round strong @click="emit('resume')">
          <template #icon><Play :size="15" /></template>
          {{ isPaused ? '继续队列' : '开始队列' }}
        </NButton>
        <NButton v-if="isRunning && !pauseRequested" round strong @click="emit('pause')">
          <template #icon><Pause :size="15" /></template>
          本章后暂停
        </NButton>
        <NButton v-if="isRunning" type="error" secondary round strong @click="emit('stop')">
          <template #icon><Square :size="14" /></template>
          立即停止
        </NButton>
        <NButton v-if="!isRunning" round strong @click="emit('close')">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.batch-draft-layout,
.batch-summary > div,
.batch-item > div {
  display: grid;
  gap: 5px;
}

.batch-draft-layout {
  gap: 16px;
}

.batch-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.batch-summary strong,
.batch-item strong {
  color: var(--arc-text-primary);
}

.batch-summary span,
.batch-item span,
.current-progress span {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.current-progress {
  display: grid;
  gap: 7px;
  padding: 12px;
  border-radius: var(--arc-radius-md);
  background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-surface));
}

.batch-items {
  max-height: min(420px, 48vh);
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
}

.batch-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--arc-border);
}

.batch-item:last-child {
  border-bottom: 0;
}

.batch-item > svg {
  margin-top: 2px;
  flex-shrink: 0;
}

.batch-item > div {
  min-width: 0;
}

.batch-item strong,
.batch-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.running { color: var(--arc-primary); }
.completed { color: #10b981; }
.failed { color: #ef4444; }
.pending { color: var(--arc-text-hint); }

.spinning {
  animation: spin 0.9s linear infinite;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
