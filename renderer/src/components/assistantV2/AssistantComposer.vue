<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NButton, NCheckbox, NPopover, NRadio, NRadioGroup } from 'naive-ui'
import { ChevronDown, ClipboardList, LoaderCircle, Sparkles, Square, Undo2, X } from 'lucide-vue-next'
import type { AssistantTurnPreview, SkillUseMode, SkillUsePolicy } from '@shared/assistant-runtime'
import type { ProjectSkillItem } from '@/types/app'

const props = withDefaults(defineProps<{
  modelValue: string
  isStreaming: boolean
  isCanceling?: boolean
  modeLabel?: string
  streamingCharCount?: number
  isEditing?: boolean
  restoredLabel?: string
  skillPolicy?: SkillUsePolicy
  availableSkills?: ProjectSkillItem[]
  turnPreview?: AssistantTurnPreview | null
  isPreviewing?: boolean
}>(), {
  skillPolicy: () => ({ mode: 'auto', skillIds: [] }),
  availableSkills: () => []
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'cancel'): void
  (e: 'edit-last'): void
  (e: 'clear-restored'): void
  (e: 'update:skill-policy', value: SkillUsePolicy): void
  (e: 'preview'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
let lastEscapeAt = 0

const skillPolicyLabel = computed(() => {
  if (props.skillPolicy.mode === 'off') return '技能：不使用'
  if (props.skillPolicy.mode === 'only') return `技能：仅使用（${props.skillPolicy.skillIds.length}）`
  return '技能：自动'
})

const sendDisabled = computed(() => (
  props.isEditing
  || !props.modelValue.trim()
  || (props.skillPolicy.mode === 'only' && props.skillPolicy.skillIds.length === 0)
))

function contextStateLabel(state: AssistantTurnPreview['contextItems'][number]['state']): string {
  if (state === 'compressed') return '已压缩'
  if (state === 'omitted') return '按需读取'
  return '已加载'
}

function skillStateLabel(state: AssistantTurnPreview['skills'][number]['state']): string {
  if (state === 'loaded') return '已读取'
  if (state === 'injected') return '已注入'
  return '候选'
}

function setSkillMode(mode: SkillUseMode): void {
  emit('update:skill-policy', { ...props.skillPolicy, mode })
}

function toggleSkill(skillId: string, checked: boolean): void {
  const selected = props.skillPolicy.skillIds
  emit('update:skill-policy', {
    mode: 'only',
    skillIds: checked
      ? [...new Set([...selected, skillId])]
      : selected.filter((id) => id !== skillId)
  })
}

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  autosize(target)
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(180, el.scrollHeight) + 'px'
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.isStreaming && !props.isEditing) {
    const now = Date.now()
    if (now - lastEscapeAt <= 600) {
      lastEscapeAt = 0
      event.preventDefault()
      emit('edit-last')
    } else {
      lastEscapeAt = now
    }
    return
  }
  lastEscapeAt = 0
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (props.isStreaming || props.isEditing) return
    emit('send')
  }
}

watch(
  () => props.restoredLabel,
  async (label) => {
    if (!label) return
    await nextTick()
    if (!textareaRef.value) return
    textareaRef.value.focus()
    autosize(textareaRef.value)
  }
)
</script>

<template>
  <div class="composer-wrap">
    <div class="composer" :class="{ streaming: props.isStreaming, editing: props.isEditing }">
      <div v-if="props.restoredLabel" class="restored-draft">
        <Undo2 :size="12" />
        <span>{{ props.restoredLabel }}</span>
        <button type="button" title="清除回填内容" aria-label="清除回填内容" @click="emit('clear-restored')">
          <X :size="11" />
        </button>
      </div>
      <div v-if="props.modelValue.trim()" class="turn-preview-row">
        <NPopover trigger="click" placement="top-start" :show-arrow="false" :disabled="props.isStreaming || props.isEditing">
          <template #trigger>
            <button
              type="button"
              class="turn-preview-trigger"
              :disabled="props.isStreaming || props.isEditing"
              @click="emit('preview')"
            >
              <LoaderCircle v-if="props.isPreviewing" :size="12" class="spin" />
              <ClipboardList v-else :size="12" />
              <template v-if="props.turnPreview">
                {{ props.turnPreview.intentLabel }} · {{ props.turnPreview.contextItems.length }} 类资料 · {{ props.turnPreview.skills.length }} 个 Skill
              </template>
              <template v-else>{{ props.isPreviewing ? '正在规划本轮…' : '查看本轮会怎样执行' }}</template>
            </button>
          </template>
          <div class="turn-preview-popover">
            <div class="preview-head">
              <strong>本轮执行预览</strong>
              <span>只在本地规划，不调用模型</span>
            </div>
            <div v-if="props.isPreviewing" class="preview-loading">正在核对上下文和 Skill…</div>
            <template v-else-if="props.turnPreview">
              <div class="preview-summary">
                <span>任务：{{ props.turnPreview.intentLabel }}</span>
                <span>模型：{{ props.turnPreview.provider }} / {{ props.turnPreview.model }}</span>
                <span>调用：{{ props.turnPreview.estimatedModelCalls }}，最多 {{ props.turnPreview.maxModelCalls }} 轮</span>
                <span>{{ props.turnPreview.writesToStaging ? '修改进入暂存区确认' : '本轮默认只回复，不直接写入' }}</span>
              </div>
              <div class="preview-section">
                <strong>将使用的资料</strong>
                <div class="preview-chips">
                  <span v-for="item in props.turnPreview.contextItems" :key="item.providerId" :class="item.state">
                    {{ item.label }} · {{ contextStateLabel(item.state) }}
                  </span>
                </div>
                <small>预计上下文约 {{ props.turnPreview.contextUsedTokens.toLocaleString('zh-CN') }} tokens</small>
              </div>
              <div class="preview-section">
                <strong>Skill</strong>
                <div v-if="props.turnPreview.skills.length" class="preview-chips">
                  <span v-for="skill in props.turnPreview.skills" :key="skill.id">
                    {{ skill.name }} · {{ skillStateLabel(skill.state) }}
                  </span>
                </div>
                <small v-else>本轮不会注入 Skill。</small>
              </div>
              <div v-if="props.turnPreview.warnings.length" class="preview-warnings">
                <span v-for="warning in props.turnPreview.warnings" :key="warning">{{ warning }}</span>
              </div>
            </template>
            <div v-else class="preview-loading">点击后生成准确预览。</div>
          </div>
        </NPopover>
      </div>
      <textarea
        ref="textareaRef"
        :value="props.modelValue"
        :disabled="props.isEditing"
        :placeholder="props.isEditing ? '正在编辑历史提问' : '继续追问，或让助理动手。Enter 发送 · Shift+Enter 换行'"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <div class="foot">
        <div class="hint">
          <span v-if="props.modeLabel" class="mode-chip">{{ props.modeLabel }}</span>
          <span v-if="props.isEditing">正在编辑历史提问</span>
          <span v-else-if="props.isStreaming" class="streaming-hint">
            <span class="streaming-dot" />AI 正在回答<template v-if="props.streamingCharCount && props.streamingCharCount > 0"> · 已生成 {{ props.streamingCharCount }} 字</template>
          </span>
          <span v-else>AI的修改会显示在暂存区，需要你逐条确认。</span>
        </div>
        <div class="actions">
          <NPopover trigger="click" placement="top-end" :show-arrow="false" :disabled="props.isStreaming || props.isEditing">
            <template #trigger>
              <button
                type="button"
                class="skill-policy-trigger"
                :disabled="props.isStreaming || props.isEditing"
                :title="skillPolicyLabel"
              >
                <Sparkles :size="13" />
                <span>{{ skillPolicyLabel }}</span>
                <ChevronDown :size="12" />
              </button>
            </template>
            <div class="skill-policy-popover">
              <strong>本对话 Skill 规则</strong>
              <NRadioGroup :value="props.skillPolicy.mode" @update:value="setSkillMode">
                <div class="skill-mode-list">
                  <NRadio value="auto">自动匹配</NRadio>
                  <NRadio value="only">仅使用指定</NRadio>
                  <NRadio value="off">不使用</NRadio>
                </div>
              </NRadioGroup>
              <div v-if="props.skillPolicy.mode === 'only'" class="skill-only-list">
                <span v-if="props.availableSkills.length === 0" class="skill-empty">当前项目没有已启用的可用 Skill。</span>
                <template v-else>
                  <NCheckbox
                    v-for="skill in props.availableSkills"
                    :key="skill.id"
                    :checked="props.skillPolicy.skillIds.includes(skill.id)"
                    @update:checked="toggleSkill(skill.id, $event)"
                  >{{ skill.name }}</NCheckbox>
                </template>
              </div>
              <small v-if="props.skillPolicy.mode === 'only' && props.skillPolicy.skillIds.length === 0" class="skill-warning">
                请至少选择一个 Skill 后再发送。
              </small>
              <small v-else class="skill-policy-note">该选择保留在当前对话中，不会修改项目默认规则。</small>
            </div>
          </NPopover>
          <NButton
            v-if="props.isStreaming"
            size="small"
            type="error"
            secondary
            :disabled="props.isCanceling"
            @click="emit('cancel')"
          >
            <template #icon><Square :size="13" fill="currentColor" /></template>
            {{ props.isCanceling ? '停止中' : '停止生成' }}
          </NButton>
          <NButton
            v-else
            size="small"
            type="primary"
            :disabled="sendDisabled"
            @click="emit('send')"
          >
            发送
          </NButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  padding: 12px 32px 22px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 30%);
}
.composer {
  max-width: 720px;
  margin: 0 auto;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 16px;
  padding: 12px 14px 10px;
  box-shadow: var(--arc-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
.composer.streaming {
  border-color: rgba(13, 125, 90, 0.4);
  box-shadow: 0 0 0 3px rgba(13, 125, 90, 0.06), var(--arc-shadow-md);
}
.composer.editing {
  opacity: 0.56;
}
.restored-draft {
  align-self: flex-start;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
}
.restored-draft span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restored-draft button {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.restored-draft button:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
}
.turn-preview-row {
  display: flex;
  min-width: 0;
}
.turn-preview-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 10.5px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.turn-preview-trigger:disabled { cursor: not-allowed; opacity: 0.55; }
.spin { animation: previewSpin 0.9s linear infinite; }
@keyframes previewSpin { to { transform: rotate(360deg); } }
.turn-preview-popover {
  width: min(420px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px;
}
.preview-head,
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview-head span,
.preview-section small,
.preview-loading {
  color: var(--arc-text-hint);
  font-size: 11px;
}
.preview-summary {
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-text-secondary);
  font-size: 11px;
}
.preview-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.preview-chips span {
  padding: 3px 7px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  color: var(--arc-text-secondary);
  font-size: 10.5px;
}
.preview-chips span.compressed,
.preview-chips span.omitted { color: #b45309; border-color: rgba(180, 83, 9, 0.25); }
.preview-warnings {
  display: grid;
  gap: 4px;
  color: #b45309;
  font-size: 11px;
}
textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--arc-text-primary);
  min-height: 40px;
  max-height: 180px;
  line-height: 1.5;
  padding: 0;
  font-size: 14px;
}
textarea:disabled {
  cursor: not-allowed;
}
textarea::placeholder {
  color: var(--arc-text-hint);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hint {
  font-size: 11.5px;
  color: var(--arc-text-hint);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.mode-chip {
  flex: 0 1 auto;
  max-width: 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}
.hint > span:not(.mode-chip):not(.streaming-hint) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.streaming-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--arc-primary);
  font-weight: 500;
}
.streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: streamPulse 1.4s ease-in-out infinite;
}
@keyframes streamPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.skill-policy-trigger {
  min-width: 0;
  max-width: 170px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.skill-policy-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-policy-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 50%, var(--arc-border));
  color: var(--arc-primary);
}
.skill-policy-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.skill-policy-popover {
  width: min(320px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px;
}
.skill-policy-popover > strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}
.skill-mode-list,
.skill-only-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.skill-only-list {
  max-height: 210px;
  padding: 9px 10px;
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
}
.skill-empty,
.skill-policy-note,
.skill-warning {
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.5;
}
.skill-warning {
  color: var(--arc-danger, #d03050);
}
</style>
