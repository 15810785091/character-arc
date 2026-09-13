<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NInputNumber, NModal, useMessage } from 'naive-ui'
import { MAX_CHAPTER_SPLIT_COUNT, MIN_CHAPTER_SPLIT_COUNT, planChapterSplit } from '@/features/chapters/chapterSplit'
import { useAppStore } from '@/stores/app'
import type { ChapterDraft } from '@/types/app'

const props = defineProps<{
  show: boolean
  chapter: ChapterDraft | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const appStore = useAppStore()
const message = useMessage()
const partCount = ref(3)
const isSubmitting = ref(false)

const preview = computed(() => {
  if (!props.chapter) return { plan: null, error: '未找到要拆分的章节。' }
  try {
    return { plan: planChapterSplit(props.chapter, partCount.value), error: '' }
  } catch (error) {
    return {
      plan: null,
      error: error instanceof Error ? error.message : '无法生成章节拆分预览。'
    }
  }
})

watch(
  () => [props.show, props.chapter?.id] as const,
  ([show]) => {
    if (!show || !props.chapter) return
    try {
      planChapterSplit(props.chapter, 3)
      partCount.value = 3
    } catch {
      partCount.value = 2
    }
  },
  { immediate: true }
)

function close(): void {
  if (!isSubmitting.value) emit('update:show', false)
}

function handleShowUpdate(value: boolean): void {
  if (!isSubmitting.value) emit('update:show', value)
}

async function submit(): Promise<void> {
  const plan = preview.value.plan
  if (!plan || isSubmitting.value) return
  isSubmitting.value = true
  try {
    const chapterIds = appStore.splitChapter(plan)
    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      message.error(`章节已拆分，但保存失败：${appStore.persistenceError}`)
      return
    }
    emit('update:show', false)
    message.success(`已按完整段落拆分为 ${chapterIds.length} 章，并保留拆分前版本。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '拆分章节失败。')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`拆分《${chapter?.title || '未命名章节'}》`"
    :style="{ width: 'min(720px, 94vw)' }"
    :bordered="false"
    :closable="!isSubmitting"
    :mask-closable="!isSubmitting"
    @update:show="handleShowUpdate"
  >
    <div class="split-count-row">
      <div>
        <div class="split-label">拆成几章</div>
        <div class="split-description">正文只会在完整段落之间切分，不会改写或重复内容。</div>
      </div>
      <n-input-number
        v-model:value="partCount"
        :min="MIN_CHAPTER_SPLIT_COUNT"
        :max="MAX_CHAPTER_SPLIT_COUNT"
        :precision="0"
        button-placement="both"
        style="width: 142px"
      />
    </div>

    <n-alert v-if="preview.error" type="warning" :show-icon="false">
      {{ preview.error }}
    </n-alert>

    <template v-else-if="preview.plan">
      <n-alert type="info" :show-icon="false">
        本章共有 {{ preview.plan.paragraphCount }} 个有效段落，已按正文长度自动均衡。
      </n-alert>
      <div class="split-preview-list">
        <div v-for="(part, index) in preview.plan.parts" :key="index" class="split-preview-item">
          <span class="split-index">{{ index + 1 }}</span>
          <div class="split-preview-copy">
            <strong>{{ part.title }}</strong>
            <span>第 {{ part.paragraphStart }}–{{ part.paragraphEnd }} 段 · 目标 {{ Number(part.wordTarget).toLocaleString() }} 字</span>
          </div>
          <span class="split-character-count">{{ part.characterCount.toLocaleString() }} 字</span>
        </div>
      </div>
      <p class="split-footnote">第一部分保留原章节 ID；其他部分紧跟其后，并继承分卷、大纲关联、摘要和状态。后续章节不会自动改名。</p>
    </template>

    <template #footer>
      <div class="split-actions">
        <span>拆分前会自动保存一份完整历史版本</span>
        <div>
          <n-button round strong :disabled="isSubmitting" @click="close">取消</n-button>
          <n-button
            type="primary"
            round
            strong
            :loading="isSubmitting"
            :disabled="!preview.plan"
            @click="submit"
          >
            确认拆分
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.split-count-row,
.split-actions,
.split-preview-item {
  display: flex;
  align-items: center;
}

.split-count-row {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.split-label {
  color: var(--arc-text-primary);
  font-weight: 700;
}

.split-description,
.split-preview-copy span,
.split-footnote,
.split-actions > span {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.split-preview-list {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  max-height: 360px;
  overflow-y: auto;
}

.split-preview-item {
  gap: 12px;
  padding: 11px 13px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
}

.split-index {
  display: inline-flex;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--arc-primary);
  color: white;
  font-size: 11px;
}

.split-preview-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.split-preview-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split-character-count {
  color: var(--arc-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.split-footnote {
  margin: 14px 0 0;
}

.split-actions {
  justify-content: space-between;
  gap: 16px;
}

.split-actions > div {
  display: flex;
  gap: 10px;
}
</style>
