<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Minimize } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import ChapterTreeSidebar from './ChapterTreeSidebar.vue'
import ChapterEditorPane from './ChapterEditorPane.vue'
import ChapterAiPanelV2 from './ChapterAiPanelV2.vue'
import ChapterFirstDraftConfigDialog from './ChapterFirstDraftConfigDialog.vue'
import ChapterBatchDraftDialog, { type ChapterBatchDraftItem } from './ChapterBatchDraftDialog.vue'
import { normalizeChapterWritingContract, useChapterFirstDraft, type FirstDraftConfig } from './useChapterFirstDraft'
import type { SurfaceDefinition } from '@shared/assistant-runtime'
import { useAssistant } from '@/composables/useAssistant'
import { useAppStore } from '@/stores/app'
import { parseChapterWordTarget } from '@/features/chapters/wordTarget'

const appStore = useAppStore()
const { selectedProjectId, selectedChapter } = storeToRefs(appStore)
const message = useMessage()
const draft = useChapterFirstDraft()

// 章节 AI 助手实例：上移到此处，不依赖 ChapterAiPanelV2 是否挂载
const CHAPTER_SURFACE: SurfaceDefinition = {
  id: 'chapter-panel',
  scope: 'chapter',
  autoCommit: false,
  maxSteps: 6
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: CHAPTER_SURFACE,
  scopeRef: () => selectedChapter.value ? `chapter:${selectedChapter.value.id}` : undefined
})

const COMPACT_BREAKPOINT = 1180
const COMPACT_BREAKPOINT_AI_OPEN = 1440
const DEFAULT_AI_WIDTH = 380
const MIN_AI_WIDTH = 280
const MAX_AI_WIDTH = 600

const aiOpen = ref(true)
const focusMode = ref(false)
const referenceOpen = ref(false)
const sidebarDrawerVisible = ref(false)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const aiPanelWidth = ref(DEFAULT_AI_WIDTH)
const isDraggingPanel = ref(false)
const draftConfigVisible = ref(false)
const pendingBatchChapterIds = ref<string[]>([])
const batchDialogVisible = ref(false)
const batchItems = ref<ChapterBatchDraftItem[]>([])
const batchBaseConfig = ref<FirstDraftConfig | null>(null)
const batchRunning = ref(false)
const batchPaused = ref(false)
const batchPauseRequested = ref(false)
let batchStopRequested = false

type PersistedBatchDraftQueue = {
  version: 1
  projectId: string
  baseConfig: FirstDraftConfig
  items: ChapterBatchDraftItem[]
  updatedAt: string
}

function batchStorageKey(projectId = selectedProjectId.value): string {
  return `arc-chapter-draft-queue:${projectId}`
}

function persistBatchQueue(): void {
  const projectId = selectedProjectId.value
  if (!projectId || !batchBaseConfig.value || batchItems.value.length === 0) return
  const payload: PersistedBatchDraftQueue = {
    version: 1,
    projectId,
    baseConfig: batchBaseConfig.value,
    items: batchItems.value,
    updatedAt: new Date().toISOString()
  }
  localStorage.setItem(batchStorageKey(projectId), JSON.stringify(payload))
}

function clearCompletedBatchQueue(): void {
  const projectId = selectedProjectId.value
  if (projectId) localStorage.removeItem(batchStorageKey(projectId))
}

function restoreBatchQueue(): void {
  const projectId = selectedProjectId.value
  if (!projectId) return
  try {
    const raw = localStorage.getItem(batchStorageKey(projectId))
    if (!raw) return
    const queue = JSON.parse(raw) as Partial<PersistedBatchDraftQueue>
    if (queue.version !== 1 || queue.projectId !== projectId || !queue.baseConfig || !Array.isArray(queue.items)) return
    const existingIds = new Set(appStore.chapters.map((chapter) => chapter.id))
    batchBaseConfig.value = queue.baseConfig
    batchItems.value = queue.items
      .filter((item) => existingIds.has(item.chapterId))
      .map((item) => ({ ...item, status: item.status === 'running' ? 'pending' : item.status }))
    if (batchItems.value.some((item) => item.status !== 'completed')) {
      batchPaused.value = true
      batchDialogVisible.value = true
      message.info('已恢复上次未完成的批量初稿队列')
    } else {
      clearCompletedBatchQueue()
    }
  } catch {
    localStorage.removeItem(batchStorageKey(projectId))
  }
}

const isCompact = computed(() => {
  const threshold = aiOpen.value ? COMPACT_BREAKPOINT_AI_OPEN : COMPACT_BREAKPOINT
  return viewportWidth.value <= threshold
})

const effectiveAiWidth = computed(() => {
  if (isCompact.value) return Math.min(aiPanelWidth.value, 320)
  return aiPanelWidth.value
})

const gridStyle = computed(() => {
  if (focusMode.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  if (isCompact.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  return { gridTemplateColumns: aiOpen.value ? `280px 1fr 4px ${effectiveAiWidth.value}px` : '280px 1fr' }
})

const aiPanelRef = ref<InstanceType<typeof ChapterAiPanelV2> | null>(null)

function toggleAi(): void {
  aiOpen.value = !aiOpen.value
}

function toggleFocus(): void {
  focusMode.value = !focusMode.value
}

function toggleReference(): void {
  referenceOpen.value = !referenceOpen.value
  localStorage.setItem('arc-chapter-reference-open', String(referenceOpen.value))
}

function toggleSidebar(): void {
  sidebarDrawerVisible.value = !sidebarDrawerVisible.value
}

function handleSelectionAction(action: string, text: string): void {
  aiOpen.value = true
  // 先把选区文本同步到 store，让 AI 面板的 hasSelection 能感知到
  const chapterId = appStore.selectedChapter?.id
  if (chapterId && text) {
    appStore.updateChapterSelection({ chapterId, text })
  }
  // 把完整文本传给 AI 面板（不截断），面板的 sendPromptWithAction 会利用 store 选区拼接上下文
  nextTick(() => {
    aiPanelRef.value?.sendPromptWithAction(action, text)
  })
}

function handleGenerateDraft(): void {
  pendingBatchChapterIds.value = []
  draftConfigVisible.value = true
}

function handleDraftConfigConfirm(config: FirstDraftConfig): void {
  draftConfigVisible.value = false
  aiOpen.value = true
  if (pendingBatchChapterIds.value.length > 0) {
    const selectedIds = new Set(pendingBatchChapterIds.value)
    batchItems.value = appStore.chapters
      .filter((chapter) => selectedIds.has(chapter.id))
      .map((chapter) => ({ chapterId: chapter.id, title: chapter.title, status: 'pending' }))
    batchBaseConfig.value = config
    pendingBatchChapterIds.value = []
    batchPaused.value = false
    batchPauseRequested.value = false
    batchDialogVisible.value = true
    persistBatchQueue()
    void runBatchQueue()
    return
  }
  nextTick(() => {
    aiPanelRef.value?.triggerDraft(config)
  })
}

function handleBatchDraft(chapterIds: string[]): void {
  const firstChapterId = chapterIds.find((id) => appStore.chapters.some((chapter) => chapter.id === id))
  if (!firstChapterId) return
  pendingBatchChapterIds.value = chapterIds
  appStore.selectChapter(firstChapterId)
  draftConfigVisible.value = true
}

function buildBatchChapterConfig(base: FirstDraftConfig, chapterId: string): FirstDraftConfig | null {
  const chapter = appStore.chapters.find((item) => item.id === chapterId)
  if (!chapter) return null
  const outline = chapter.outlineItemId
    ? appStore.outlineItems.find((item) => item.id === chapter.outlineItemId)
    : appStore.outlineItems.find((item) => item.volumeId === chapter.volumeId && item.title.trim() === chapter.title.trim())
  const povNames = (outline?.relatedCharacterIds ?? [])
    .map((id) => appStore.characters.find((character) => character.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const outlineSummary = outline?.summary?.trim() || chapter.summary.trim()
  const baseContract = normalizeChapterWritingContract(base.chapterContract)
  const isFirstBatchChapter = batchItems.value[0]?.chapterId === chapterId

  return {
    ...base,
    targetWordCount: parseChapterWordTarget(chapter.wordTarget),
    resumeFromCheckpoint: true,
    selectedReferenceWorkIds: [...base.selectedReferenceWorkIds],
    steps: Object.fromEntries(
      Object.entries(base.steps).map(([id, step]) => [id, { ...step, skillIds: [...step.skillIds] }])
    ) as FirstDraftConfig['steps'],
    chapterContract: isFirstBatchChapter
      ? baseContract
      : normalizeChapterWritingContract({
          goal: outlineSummary,
          pov: povNames.join('、'),
          timeAndPlace: '',
          conflict: outline?.conflict?.trim() || '',
          mustHappen: outlineSummary ? [outlineSummary] : [],
          forbidden: baseContract.forbidden,
          endingHook: ''
        })
  }
}

async function runBatchQueue(): Promise<void> {
  if (batchRunning.value || !batchBaseConfig.value) return
  batchRunning.value = true
  batchPaused.value = false
  batchPauseRequested.value = false
  batchStopRequested = false

  try {
    for (const item of batchItems.value) {
      if (item.status === 'completed') continue
      if (batchStopRequested) break
      if (item.status === 'failed') {
        item.status = 'pending'
        item.error = undefined
      }

      item.status = 'running'
      persistBatchQueue()
      appStore.selectChapter(item.chapterId)
      await nextTick()
      const config = buildBatchChapterConfig(batchBaseConfig.value, item.chapterId)
      if (!config) {
        item.status = 'failed'
        item.error = '章节不存在或已删除'
        batchPaused.value = true
        break
      }

      try {
        const completed = await draft.start(config, { showModal: false })
        if (completed) {
          item.status = 'completed'
          item.error = undefined
        } else {
          item.status = 'pending'
          batchPaused.value = true
          break
        }
      } catch (error) {
        item.status = 'failed'
        item.error = error instanceof Error ? error.message : '初稿生成失败'
        batchPaused.value = true
        persistBatchQueue()
        message.error(`《${item.title}》生成失败，队列已暂停`)
        break
      }

      persistBatchQueue()
      if (batchPauseRequested.value) {
        batchPaused.value = true
        break
      }
    }
  } finally {
    batchRunning.value = false
    batchPauseRequested.value = false
    const allComplete = batchItems.value.length > 0 && batchItems.value.every((item) => item.status === 'completed')
    if (allComplete) {
      batchPaused.value = false
      clearCompletedBatchQueue()
      message.success(`批量初稿完成，共生成 ${batchItems.value.length} 章`)
    } else {
      persistBatchQueue()
    }
  }
}

function pauseBatchAfterCurrent(): void {
  batchPauseRequested.value = true
}

function resumeBatchQueue(): void {
  void runBatchQueue()
}

async function stopBatchQueue(): Promise<void> {
  batchStopRequested = true
  batchPaused.value = true
  if (draft.isGenerating.value) {
    try { await draft.stop() } catch (error) { message.error(error instanceof Error ? error.message : '停止失败') }
  }
}

function closeBatchDialog(): void {
  if (batchRunning.value) return
  batchDialogVisible.value = false
}

function startPanelDrag(e: MouseEvent): void {
  e.preventDefault()
  isDraggingPanel.value = true
  const startX = e.clientX
  const startWidth = aiPanelWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(ev: MouseEvent): void {
    const delta = startX - ev.clientX
    const newWidth = Math.max(MIN_AI_WIDTH, Math.min(MAX_AI_WIDTH, startWidth + delta))
    aiPanelWidth.value = newWidth
  }

  function onEnd(): void {
    isDraggingPanel.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('arc-ai-panel-width', String(aiPanelWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function handlePanelDblClick(): void {
  aiPanelWidth.value = DEFAULT_AI_WIDTH
  localStorage.setItem('arc-ai-panel-width', String(DEFAULT_AI_WIDTH))
}

function syncViewport(): void {
  viewportWidth.value = window.innerWidth
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'F11') {
    event.preventDefault()
    toggleFocus()
    return
  }
  if (event.key === 'Escape' && referenceOpen.value) {
    referenceOpen.value = false
    localStorage.setItem('arc-chapter-reference-open', 'false')
    return
  }
  if (event.key === 'Escape' && focusMode.value) {
    toggleFocus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', syncViewport)
  const saved = localStorage.getItem('arc-ai-panel-width')
  if (saved) {
    const val = Number(saved)
    if (val >= MIN_AI_WIDTH && val <= MAX_AI_WIDTH) {
      aiPanelWidth.value = val
    }
  }
  referenceOpen.value = localStorage.getItem('arc-chapter-reference-open') === 'true'
  restoreBatchQueue()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', syncViewport)
  draft.unregisterStreamListener()
})
</script>

<template>
  <section
    class="chapter-workspace"
    :class="{ 'ai-open': aiOpen, focus: focusMode, compact: isCompact }"
    :style="gridStyle"
  >
    <ChapterTreeSidebar
      v-if="!focusMode && !isCompact"
      class="ws-sidebar"
      @batch-draft="handleBatchDraft"
    />
    <ChapterEditorPane
      class="ws-editor"
      :ai-open="aiOpen"
      :focus-mode="focusMode"
      :reference-open="referenceOpen"
      :show-sidebar-toggle="!focusMode && isCompact"
      @toggle-ai="toggleAi"
      @toggle-focus="toggleFocus"
      @toggle-reference="toggleReference"
      @toggle-sidebar="toggleSidebar"
      @selection-action="handleSelectionAction"
      @generate-draft="handleGenerateDraft"
    />
    <!-- Panel resize handle -->
    <div
      v-if="aiOpen"
      class="panel-resize-handle"
      :class="{ dragging: isDraggingPanel }"
      @mousedown="startPanelDrag"
      @dblclick="handlePanelDblClick"
    />
    <ChapterAiPanelV2
      v-if="aiOpen"
      ref="aiPanelRef"
      :assistant="assistant"
      :draft="draft"
      class="ws-ai"
      @close="aiOpen = false"
      @generate-draft="handleGenerateDraft"
    />
    <button v-if="focusMode" class="focus-exit" @click="toggleFocus">
      <Minimize :size="13" />
      <span>退出专注 (Esc)</span>
    </button>

    <Transition name="sidebar-slide">
      <div v-if="isCompact && sidebarDrawerVisible && !focusMode" class="sidebar-overlay">
        <div class="sidebar-backdrop" @click="sidebarDrawerVisible = false" />
        <div class="sidebar-panel">
          <ChapterTreeSidebar
            @navigate="sidebarDrawerVisible = false"
            @batch-draft="handleBatchDraft"
          />
        </div>
      </div>
    </Transition>

    <ChapterFirstDraftConfigDialog
      :show="draftConfigVisible"
      :batch-count="pendingBatchChapterIds.length"
      @confirm="handleDraftConfigConfirm"
      @cancel="draftConfigVisible = false; pendingBatchChapterIds = []"
    />

    <ChapterBatchDraftDialog
      :show="batchDialogVisible"
      :items="batchItems"
      :is-running="batchRunning"
      :is-paused="batchPaused"
      :pause-requested="batchPauseRequested"
      :progress-percent="draft.progressPercent.value"
      :progress-text="draft.progressText.value"
      :execution-label="draft.executionLabel.value"
      @close="closeBatchDialog"
      @pause="pauseBatchAfterCurrent"
      @resume="resumeBatchQueue"
      @stop="stopBatchQueue"
    />
  </section>
</template>

<style scoped>
.chapter-workspace {
  position: relative;
  display: grid;
  height: 100%;
  width: 100%;
  background: var(--arc-bg-body);
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.ws-sidebar,
.ws-editor,
.ws-ai {
  min-width: 0;
  min-height: 0;
}

/* ── Panel Resize Handle ── */
.panel-resize-handle {
  width: 4px;
  cursor: col-resize;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.panel-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 0;
  border-radius: 1px;
  background: var(--arc-border-strong);
  transform: translate(-50%, -50%);
  transition: all 0.2s ease;
  opacity: 0;
}

.panel-resize-handle:hover::after {
  height: 32px;
  opacity: 0.6;
}

.panel-resize-handle.dragging::after {
  height: 100%;
  opacity: 1;
  background: var(--arc-primary);
  width: 2px;
}

/* ── Focus Exit ── */
.focus-exit {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 100;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
}

.focus-exit:hover {
  color: var(--arc-text-primary);
}

/* ── Sidebar Overlay ── */
.sidebar-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
}

.sidebar-panel {
  position: relative;
  width: 300px;
  height: 100%;
  box-shadow: var(--arc-shadow-lg);
  z-index: 1;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: opacity 0.2s ease;
}

.sidebar-slide-enter-active .sidebar-panel,
.sidebar-slide-leave-active .sidebar-panel {
  transition: transform 0.2s ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  opacity: 0;
}

.sidebar-slide-enter-from .sidebar-panel,
.sidebar-slide-leave-to .sidebar-panel {
  transform: translateX(-100%);
}
</style>
