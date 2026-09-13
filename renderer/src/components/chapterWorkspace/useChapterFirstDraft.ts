import { ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterWritingPacket, buildOutlineItemContext, type ChapterFirstDraftContextInput } from '@/features/ai/chapterAssistantContext'
import {
  ensureEditorHtmlContent,
  getChapterPreviewText,
  getPlainTextFromEditorContent
} from '@/features/chapters/editorContent'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { useAppStore } from '@/stores/app'
import type { KnowledgeDocument, ReferenceStyleAnalysis } from '@/types/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { stripReasoningMarkup } from '@/features/ai/reasoning'
import { buildChapterWordCountIssue } from '@shared/chapter-audit-policy'

const TASK_KEY = 'chapter-first-draft'

export type FirstDraftStepId = 'memo' | 'draft' | 'audit' | 'repair' | 'humanize' | 'session-note'
export type FirstDraftFailurePolicy = 'skip' | 'stop'
export type FirstDraftSkillMode = 'auto' | 'only' | 'off'
export type FirstDraftStrategy = 'quick' | 'balanced' | 'strict'

export type ChapterWritingContract = {
  goal: string
  pov: string
  timeAndPlace: string
  conflict: string
  mustHappen: string[]
  forbidden: string[]
  endingHook: string
}

export type FirstDraftStepConfig = {
  id: FirstDraftStepId
  enabled: boolean
  skillMode: FirstDraftSkillMode
  skillIds: string[]
  userPrompt: string
  failurePolicy: FirstDraftFailurePolicy
}

export type FirstDraftConfig = {
  strategy: FirstDraftStrategy
  targetWordCount: number
  selectedReferenceWorkIds: string[]
  userPrompt: string
  chapterContract: ChapterWritingContract
  resumeFromCheckpoint?: boolean
  steps: Record<FirstDraftStepId, FirstDraftStepConfig>
}

export type FirstDraftRunOptions = {
  showModal?: boolean
}

export type FirstDraftCheckpoint = {
  version: 1
  projectId: string
  chapterId: string
  updatedAt: string
  configSignature: string
  config: FirstDraftConfig
  completedSteps: FirstDraftStepId[]
  skippedSteps?: FirstDraftStepId[]
  chapterMemo?: ChapterFirstDraftContextInput['chapterMemo']
  currentText?: string
  auditResult?: ChapterAuditPayload | null
}

export const FIRST_DRAFT_CHECKPOINT_SOURCE_LABEL = 'chapter-draft-checkpoint'
export const CHAPTER_CONTRACT_SOURCE_LABEL = 'chapter-writing-contract'

function normalizeContractList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 12)
    : []
}

export function normalizeChapterWritingContract(value: unknown): ChapterWritingContract {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    goal: String(input.goal ?? '').trim(),
    pov: String(input.pov ?? '').trim(),
    timeAndPlace: String(input.timeAndPlace ?? '').trim(),
    conflict: String(input.conflict ?? '').trim(),
    mustHappen: normalizeContractList(input.mustHappen),
    forbidden: normalizeContractList(input.forbidden),
    endingHook: String(input.endingHook ?? '').trim()
  }
}

export function getFirstDraftConfigSignature(config: FirstDraftConfig): string {
  return JSON.stringify({
    strategy: config.strategy,
    targetWordCount: config.targetWordCount,
    selectedReferenceWorkIds: [...config.selectedReferenceWorkIds].sort(),
    userPrompt: config.userPrompt,
    chapterContract: normalizeChapterWritingContract(config.chapterContract),
    steps: FIRST_DRAFT_STEP_DEFINITIONS.map(({ id }) => ({
      id,
      enabled: config.steps[id]?.enabled ?? false,
      skillMode: config.steps[id]?.skillMode ?? 'auto',
      skillIds: [...(config.steps[id]?.skillIds ?? [])].sort(),
      userPrompt: config.steps[id]?.userPrompt ?? '',
      failurePolicy: config.steps[id]?.failurePolicy ?? 'skip'
    }))
  })
}

export function findFirstDraftCheckpoint(
  documents: readonly KnowledgeDocument[],
  chapterId: string
): FirstDraftCheckpoint | null {
  const document = documents
    .filter((item) => item.sourceLabel === FIRST_DRAFT_CHECKPOINT_SOURCE_LABEL)
    .find((item) => String(item.metadata?.chapterId ?? '') === chapterId)
  if (!document) return null
  try {
    const parsed = JSON.parse(document.content) as Partial<FirstDraftCheckpoint>
    if (parsed.version !== 1 || parsed.chapterId !== chapterId || !parsed.config) return null
    return {
      version: 1,
      projectId: String(parsed.projectId ?? document.projectId ?? ''),
      chapterId,
      updatedAt: String(parsed.updatedAt ?? document.updatedAt ?? ''),
      configSignature: String(parsed.configSignature ?? ''),
      config: {
        ...parsed.config,
        chapterContract: normalizeChapterWritingContract(parsed.config.chapterContract),
        resumeFromCheckpoint: true
      },
      completedSteps: Array.isArray(parsed.completedSteps)
        ? parsed.completedSteps.filter((id): id is FirstDraftStepId => FIRST_DRAFT_STEP_DEFINITIONS.some((step) => step.id === id))
        : [],
      skippedSteps: Array.isArray(parsed.skippedSteps)
        ? parsed.skippedSteps.filter((id): id is FirstDraftStepId => FIRST_DRAFT_STEP_DEFINITIONS.some((step) => step.id === id))
        : [],
      chapterMemo: parsed.chapterMemo,
      currentText: String(parsed.currentText ?? ''),
      auditResult: parsed.auditResult ?? null
    }
  } catch {
    return null
  }
}

export function findChapterWritingContract(
  documents: readonly KnowledgeDocument[],
  chapterId: string
): ChapterWritingContract | null {
  const document = documents
    .filter((item) => item.sourceLabel === CHAPTER_CONTRACT_SOURCE_LABEL)
    .find((item) => String(item.metadata?.chapterId ?? '') === chapterId)
  if (!document) return null
  const metadataContract = document.metadata?.contract
  if (metadataContract && typeof metadataContract === 'object') {
    return normalizeChapterWritingContract(metadataContract)
  }
  try {
    return normalizeChapterWritingContract(JSON.parse(document.content))
  } catch {
    return null
  }
}

function formatChapterWritingContractDocument(contract: ChapterWritingContract): string {
  const list = (items: string[]): string => items.length ? items.map((item) => `- ${item}`).join('\n') : '- 无'
  return [
    `本章目标：${contract.goal || '未指定'}`,
    `视角人物：${contract.pov || '未指定'}`,
    `时间地点：${contract.timeAndPlace || '未指定'}`,
    `核心冲突：${contract.conflict || '无明确冲突'}`,
    '必须发生：',
    list(contract.mustHappen),
    '禁止出现：',
    list(contract.forbidden),
    `结尾钩子：${contract.endingHook || '未指定'}`
  ].join('\n')
}

export const FIRST_DRAFT_STEP_DEFINITIONS: Array<{
  id: FirstDraftStepId
  label: string
  description: string
  required?: boolean
  defaultEnabled: boolean
  defaultFailurePolicy: FirstDraftFailurePolicy
}> = [
  { id: 'memo', label: '写作备忘', description: '先规划本章硬契约，供正文生成和审计使用。', defaultEnabled: true, defaultFailurePolicy: 'skip' },
  { id: 'draft', label: '生成初稿', description: '基于章节摘要、设定、参考作品和写作备忘生成整章正文。', required: true, defaultEnabled: true, defaultFailurePolicy: 'stop' },
  { id: 'audit', label: 'AI 深度审计', description: '严格模式下检查备忘兑现、章首章尾钩子和硬规则。', defaultEnabled: false, defaultFailurePolicy: 'skip' },
  { id: 'repair', label: '自动修复', description: '严格模式下发现关键问题时，再调用 AI 最小修复正文。', defaultEnabled: false, defaultFailurePolicy: 'skip' },
  { id: 'humanize', label: '去 AI 味润色', description: '在修复之后整章润色，只改表达，不改剧情。', defaultEnabled: false, defaultFailurePolicy: 'skip' },
  { id: 'session-note', label: '写作日志', description: '把本章备忘和检查结果直接整理成项目日志，不再额外调用 AI。', defaultEnabled: false, defaultFailurePolicy: 'skip' }
]

export function createDefaultFirstDraftSteps(): Record<FirstDraftStepId, FirstDraftStepConfig> {
  return FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, step) => {
    acc[step.id] = {
      id: step.id,
      enabled: step.required ? true : step.defaultEnabled,
      skillMode: 'auto',
      skillIds: [],
      userPrompt: '',
      failurePolicy: step.defaultFailurePolicy
    }
    return acc
  }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
}

export function createFirstDraftStepsForStrategy(strategy: FirstDraftStrategy): Record<FirstDraftStepId, FirstDraftStepConfig> {
  const steps = createDefaultFirstDraftSteps()
  if (strategy === 'quick') {
    steps.memo.enabled = false
  }
  if (strategy === 'strict') {
    steps.audit.enabled = true
    steps.repair.enabled = true
    steps['session-note'].enabled = true
  }
  return steps
}

function resolveFirstDraftSteps(config: FirstDraftConfig): Record<FirstDraftStepId, FirstDraftStepConfig> {
  const defaults = createDefaultFirstDraftSteps()
  return FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, step) => {
    const current = config.steps?.[step.id]
    acc[step.id] = {
      ...defaults[step.id],
      ...current,
      id: step.id,
      enabled: step.required ? true : (current?.enabled ?? defaults[step.id].enabled),
      skillMode: current?.skillMode === 'only' || current?.skillMode === 'off'
        ? current.skillMode
        : (current?.skillMode as string) === 'manual' ? 'only' : 'auto',
      skillIds: Array.isArray(current?.skillIds) ? [...current.skillIds] : []
    }
    return acc
  }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
}

function appendStepPrompt(base: string, stepPrompt: string): string {
  const trimmed = stepPrompt.trim()
  if (!trimmed) return base
  return `${base}\n\n本步骤补充要求：${trimmed}`
}

function finalCleanGeneratedChapterText(text: string): string {
  const normalized = stripReasoningMarkup(text)
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:I am Claude,?\s+made by Anthropic\.?|我是\s*Claude[^\n]*|我理解了[^\n]*|以下是[^\n]*|修复后的完整章节正文[:：]?|润色后的完整章节正文[:：]?|正文[:：]?)\s*/i, '')
    .replace(/(?:^|\n)\s*(?:---+|\*\*\*+|===+)\s*(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized
}

function formatMemoForRepair(memo: Record<string, unknown>): string {
  const parts: string[] = []
  if (memo.currentTask) parts.push(`任务：${memo.currentTask}`)
  if (memo.emotionArc) parts.push(`情绪轨迹：${memo.emotionArc}`)
  if (Array.isArray(memo.payoffs) && memo.payoffs.length > 0) parts.push(`兑现：${memo.payoffs.join('；')}`)
  if (Array.isArray(memo.doNotDo) && memo.doNotDo.length > 0) parts.push(`红线：${memo.doNotDo.join('；')}`)
  return parts.join('\n')
}

function normalizeAuditWordCount(
  audit: ChapterAuditPayload,
  targetWordCount: number,
  measuredWordCount: number
): ChapterAuditPayload {
  const measured = Math.max(Number(measuredWordCount) || 0, 0)
  const issues = audit.issues.filter((issue) => issue.category !== 'word-count')
  const wordCountIssue = buildChapterWordCountIssue(targetWordCount, measured)
  if (wordCountIssue) issues.push(wordCountIssue)

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  return {
    ...audit,
    wordCount: measured,
    issues,
    pass: criticalCount === 0 && warningCount <= 2
  }
}

function buildLocalDraftAudit(text: string, targetWordCount: number): ChapterAuditPayload {
  const trimmed = text.trim()
  const issues: ChapterAuditPayload['issues'] = []
  const paragraphs = trimmed.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const duplicates = paragraphs.length - new Set(paragraphs).size
  if (duplicates > 0) {
    issues.push({
      severity: 'warning',
      category: 'duplicate-paragraph',
      ref: `检测到 ${duplicates} 个完全重复段落`,
      hint: '建议人工检查重复段落；平衡模式不会为此额外调用 AI。'
    })
  }
  return normalizeAuditWordCount({ pass: true, wordCount: trimmed.length, issues }, targetWordCount, trimmed.length)
}

/** 把单个参考作品的拆书分析整理成一段风格提示文本。优先用作品自带的 analysis，兜底用拆书总纲文档。 */
function formatReferenceWorkStyle(
  work: { title: string; analysis?: ReferenceStyleAnalysis },
  summaryDoc?: { summary?: string; content: string }
): string {
  const a = work.analysis
  const lines: string[] = []
  if (a?.overview) lines.push(`风格总述：${a.overview}`)
  if (a?.sentenceStyle) lines.push(`句式特征：${a.sentenceStyle}`)
  if (a?.dialogueRatio) lines.push(`对白策略：${a.dialogueRatio}`)
  if (a?.pacingControl) lines.push(`节奏控制：${a.pacingControl}`)
  if (a?.emotionExpression) lines.push(`情绪表达：${a.emotionExpression}`)
  if (a?.narrativePerspective) lines.push(`叙事视角：${a.narrativePerspective}`)
  if (a?.styleRules?.length) lines.push(`风格规则：${a.styleRules.join('；')}`)
  if (a?.reusableStylePrompt) lines.push(`仿写模板：${a.reusableStylePrompt}`)
  if (a?.avoidRules?.length) lines.push(`避免照搬：${a.avoidRules.join('；')}`)
  // analysis 为空时兜底用拆书总纲文档的摘要 / 正文
  if (!lines.length && summaryDoc) {
    const snippet = (summaryDoc.summary || summaryDoc.content || '').slice(0, 600).trim()
    if (snippet) lines.push(snippet)
  }
  if (!lines.length) return ''
  return `【${work.title}】\n${lines.join('\n')}`
}

function buildReferenceStyleContext(selectedRefIds: string[]): string {
  if (!selectedRefIds.length) return ''
  const { referenceWorks, knowledgeDocuments } = useAppStore()
  const selectedWorks = referenceWorks.filter((w) => selectedRefIds.includes(w.id))
  if (!selectedWorks.length) return ''
  // 拆书总纲文档按 sourceTitle 建索引，仅作为 analysis 缺失时的兜底数据源
  const summaryByTitle = new Map<string, { summary?: string; content: string }>()
  for (const d of knowledgeDocuments) {
    if (d.sourceType !== 'reference-summary') continue
    const title = String(d.metadata?.sourceTitle ?? '').trim()
    if (title && !summaryByTitle.has(title)) summaryByTitle.set(title, d)
  }
  const MAX_TOTAL_CHARS = 1800
  let totalChars = 0
  const parts: string[] = []
  for (const work of selectedWorks.slice(0, 3)) {
    const block = formatReferenceWorkStyle(work, summaryByTitle.get(work.title))
    if (!block) continue
    if (totalChars + block.length > MAX_TOTAL_CHARS) break
    parts.push(block)
    totalChars += block.length
  }
  return parts.join('\n\n')
}

export type ChapterAuditPayload = {
  pass: boolean
  wordCount: number
  issues: Array<{
    severity: 'critical' | 'warning' | 'hint'
    category: string
    ref: string
    hint: string
  }>
}

type StreamTaskName = 'chapter-first-draft' | 'chapter-memo' | 'chapter-audit' | 'chapter-repair' | 'chapter-humanize'

type StreamTaskResult = {
  text: string
  result?: unknown
}

export function useChapterFirstDraft(): {
  isGenerating: Ref<boolean>
  isStopping: Ref<boolean>
  modalVisible: Ref<boolean>
  streamingContent: Ref<string>
  streamingCharCount: Ref<number>
  reasoningContent: Ref<string>
  executionLabel: Ref<string>
  previewTitle: Ref<string>
  previewContent: Ref<string>
  progressPercent: Ref<number>
  progressText: Ref<string>
  auditResult: Ref<ChapterAuditPayload | null>
  isAuditing: Ref<boolean>
  elapsedSeconds: Ref<number>
  isStreaming: Ref<boolean>
  start: (config: FirstDraftConfig, options?: FirstDraftRunOptions) => Promise<boolean>
  stop: () => Promise<void>
  closeModal: () => void
  registerStreamListener: () => void
  unregisterStreamListener: () => void
} {
  const appStore = useAppStore()

  const isGenerating = ref(false)
  const isStopping = ref(false)
  const modalVisible = ref(false)
  const streamingContent = ref('')
  const streamingCharCount = ref(0)
  const reasoningContent = ref('')
  const executionLabel = ref('')
  const previewTitle = ref('')
  const previewContent = ref('')

  const streamId = ref<string | null>(null)
  const currentStreamTask = ref<StreamTaskName | null>(null)
  let resolveStream: ((result: StreamTaskResult) => void) | null = null
  let rejectStream: ((err: Error) => void) | null = null
  let removeListener: (() => void) | null = null
  // `startAiStream` returns the stream id after the main process has started
  // the request. A very fast provider can emit chunks/done before that IPC
  // response reaches the renderer, so retain those early events until the id
  // is bound below instead of dropping them.
  let awaitingStreamId = false
  let pendingStreamEvents: CharacterArcAiStreamEvent[] = []

  const progressPercent = ref(0)
  const progressText = ref('')
  const progressFloor = ref(0)

  const auditResult = ref<ChapterAuditPayload | null>(null)
  const isAuditing = ref(false)
  const activeTargetWordCount = ref(0)

  const elapsedSeconds = ref(0)
  const isStreaming = ref(false)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  function updateProgress(nextPercent: number, text: string): void {
    const bounded = Math.min(99, Math.max(0, Math.round(nextPercent)))
    progressFloor.value = Math.max(progressFloor.value, bounded)
    progressPercent.value = progressFloor.value
    progressText.value = text
  }

  function startElapsedTimer(): void {
    elapsedSeconds.value = 0
    elapsedTimer = setInterval(() => { elapsedSeconds.value++ }, 1000)
  }

  function stopElapsedTimer(): void {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  }

  function recompute(): void {
    const target = Math.max(activeTargetWordCount.value || parseChapterWordTarget(appStore.selectedChapter?.wordTarget), 1)
    const words = streamingCharCount.value || streamingContent.value.trim().length
    if (!isGenerating.value) {
      progressPercent.value = 0
      progressText.value = ''
      progressFloor.value = 0
      return
    }
    if (currentStreamTask.value === 'chapter-memo') {
      updateProgress(previewContent.value.trim() ? 10 : 6, '正在生成本章写作备忘...')
      return
    }
    if (currentStreamTask.value === 'chapter-audit') {
      updateProgress(previewContent.value.trim() ? 58 : 52, '正在审计本章质量...')
      return
    }
    if (currentStreamTask.value === 'chapter-repair') {
      updateProgress(previewContent.value.trim() ? 68 : 62, '正在自动修复审计问题...')
      return
    }
    if (currentStreamTask.value === 'chapter-humanize') {
      updateProgress(previewContent.value.trim() ? 88 : 72, '正在执行去 AI 味润色...')
      return
    }
    if (!words) {
      if (reasoningContent.value) {
        updateProgress(14, '模型正在构思本章（思考中）...')
        return
      }
      updateProgress(4, '正在整理大纲、文风和角色关系上下文...')
      return
    }
    const estimated = Math.round((words / target) * 100)
    const draftProgress = 15 + Math.min(35, Math.max(0, Math.round(estimated * 0.35)))
    updateProgress(draftProgress, `已生成 ${words} 字 / 目标 ${formatChapterWordTargetLabel(target)}（${progressPercent.value}%）`)
  }

  function reset(finalLabel = ''): void {
    streamId.value = null
    awaitingStreamId = false
    pendingStreamEvents = []
    currentStreamTask.value = null
    resolveStream = null
    rejectStream = null
    streamingCharCount.value = 0
    activeTargetWordCount.value = 0
    progressFloor.value = finalLabel.includes('完成') ? 100 : progressFloor.value
    progressPercent.value = finalLabel.includes('完成') ? 100 : progressPercent.value
    progressText.value = finalLabel || progressText.value
    executionLabel.value = finalLabel
    isStopping.value = false
    isGenerating.value = false
    isAuditing.value = false
    isStreaming.value = false
    stopElapsedTimer()
  }

  function releaseCurrentStreamState(): void {
    streamId.value = null
    awaitingStreamId = false
    resolveStream = null
    rejectStream = null
    isStopping.value = false
    isStreaming.value = false
  }

  function isAlreadyStoppedStreamError(message: string): boolean {
    return message.includes('当前没有可停止的生成任务')
  }

  function getActiveStreamBuffer(): string {
    if (currentStreamTask.value === 'chapter-first-draft') {
      return streamingContent.value
    }
    return previewContent.value
  }

  function shouldRenderStreamPreview(task: StreamTaskName | null): boolean {
    return task === 'chapter-first-draft' || task === 'chapter-memo' || task === 'chapter-repair' || task === 'chapter-humanize'
  }

  function getActiveTaskErrorMessage(): string {
    if (currentStreamTask.value === 'chapter-memo') return 'AI 写作备忘生成失败'
    if (currentStreamTask.value === 'chapter-audit') return 'AI 章节审计失败'
    if (currentStreamTask.value === 'chapter-repair') return 'AI 章节修复失败'
    if (currentStreamTask.value === 'chapter-humanize') return 'AI 去 AI 味润色失败'
    return 'AI 初稿生成失败'
  }

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId.value) {
      if (awaitingStreamId) pendingStreamEvents.push(payload)
      return
    }

    if (payload.type === 'agent_status') {
      executionLabel.value = (payload as { message?: string }).message ?? '正在分析写作技巧...'
      return
    }
    if (payload.type === 'tool_use_start') {
      const args = (payload as { toolName?: string; args?: Record<string, unknown> })
      if (args.toolName === 'skill_load') {
        executionLabel.value = `加载写作技巧：${String(args.args?.skill_id ?? '')}...`
      } else if (args.toolName === 'skill_read_reference') {
        executionLabel.value = `读取参考资料：${String(args.args?.file ?? '')}...`
      }
      return
    }
    if (payload.type === 'tool_result') {
      executionLabel.value = '技巧就绪，准备写作...'
      return
    }

    if (payload.type === 'reasoning') {
      isStreaming.value = true
      reasoningContent.value += payload.delta
      executionLabel.value = '正在构思本章（思考中）...'
      recompute()
      return
    }

    if (payload.type === 'chunk') {
      isStreaming.value = true
      if (currentStreamTask.value === 'chapter-first-draft') {
        streamingContent.value += payload.delta
        previewContent.value = streamingContent.value
        if (payload.charCount != null) streamingCharCount.value = payload.charCount
      } else if (shouldRenderStreamPreview(currentStreamTask.value)) {
        previewContent.value += payload.delta
      }
      recompute()
      return
    }
    if (payload.type === 'done') {
      const text = (payload.content?.trim() ? payload.content : getActiveStreamBuffer()).trim()
      const resolve = resolveStream
      releaseCurrentStreamState()
      resolve?.({ text, result: payload.result })
      return
    }
    if (payload.type === 'canceled') {
      const reject = rejectStream
      releaseCurrentStreamState()
      reject?.(new Error('canceled'))
      return
    }
    if (payload.type === 'error') {
      const reject = rejectStream
      releaseCurrentStreamState()
      reject?.(new Error(payload.error || getActiveTaskErrorMessage()))
    }
  }

  function registerStreamListener(): void {
    if (removeListener) return
    removeListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function unregisterStreamListener(): void {
    removeListener?.()
    removeListener = null
  }

  async function streamTask(task: StreamTaskName, context: Record<string, unknown>): Promise<StreamTaskResult> {
    currentStreamTask.value = task
    reasoningContent.value = ''
    if (task === 'chapter-first-draft') {
      streamingContent.value = ''
      streamingCharCount.value = 0
      previewTitle.value = '章节初稿实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-memo') {
      previewTitle.value = '写作备忘实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-humanize') {
      previewTitle.value = '去 AI 味润色实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-repair') {
      previewTitle.value = '自动修复实时输出'
      previewContent.value = ''
    } else {
      previewTitle.value = '章节审计进行中'
      previewContent.value = ''
    }
    // 任务切换后立即刷新进度文案，避免 progressText 停留在上一个任务（如写作备忘）。
    recompute()

    pendingStreamEvents = []
    awaitingStreamId = true
    let result: Awaited<ReturnType<typeof window.characterArc.startAiStream>>
    try {
      result = await window.characterArc.startAiStream(toIpcPayload({
        task,
        settings: appStore.appSettings,
        context
      }))
    } catch (error) {
      awaitingStreamId = false
      pendingStreamEvents = []
      throw error
    }

    const sid = (result.result as { streamId?: string } | undefined)?.streamId
    awaitingStreamId = false
    if (!result.success || !sid) {
      pendingStreamEvents = []
      throw new Error(result.error ?? getActiveTaskErrorMessage())
    }
    streamId.value = sid

    return new Promise<StreamTaskResult>((resolve, reject) => {
      resolveStream = resolve
      rejectStream = reject
      // Resolve/reject handlers must be installed before replaying events; a
      // done event may be the only event received for a fast non-streaming
      // response.
      const earlyEvents = pendingStreamEvents
      pendingStreamEvents = []
      for (const event of earlyEvents) {
        if (event.streamId === sid) handleStreamEvent(event)
      }
    })
  }

  async function start(config: FirstDraftConfig, options: FirstDraftRunOptions = {}): Promise<boolean> {
    const chapter = appStore.selectedChapter
    const project = appStore.currentProject
    const chapterVolume = appStore.selectedChapterVolume
    if (!chapter || !project || !chapterVolume) return false
    if (isGenerating.value) return false

    registerStreamListener()
    isGenerating.value = true
    isStopping.value = false
    isStreaming.value = false
    streamingContent.value = ''
    activeTargetWordCount.value = Math.max(config.targetWordCount || parseChapterWordTarget(chapter.wordTarget), 1)
    progressFloor.value = 0
    progressPercent.value = 0
    progressText.value = ''
    auditResult.value = null
    executionLabel.value = '加载角色与关系数据'
    previewTitle.value = ''
    previewContent.value = ''
    modalVisible.value = options.showModal !== false
    startElapsedTimer()
    recompute()
    let finalLabel = '本次 AI 初稿流程已完成'
    let completed = false

    try {
      await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-draft',
          label: 'AI 生成章节初稿',
          description: `正在生成《${chapter.title}》初稿`,
          panel: 'chapters',
          onCancel: () => { void stop() }
        },
        async () => {
          const targetWordCount = activeTargetWordCount.value
          const steps = resolveFirstDraftSteps(config)
          const effectiveConfig: FirstDraftConfig = {
            ...config,
            targetWordCount,
            chapterContract: normalizeChapterWritingContract(config.chapterContract),
            resumeFromCheckpoint: false,
            steps
          }
          const configSignature = getFirstDraftConfigSignature(effectiveConfig)
          const storedCheckpoint = findFirstDraftCheckpoint(appStore.knowledgeDocuments, chapter.id)
          const resumedCheckpoint = config.resumeFromCheckpoint
            && storedCheckpoint?.projectId === project.id
            && storedCheckpoint.configSignature === configSignature
            ? storedCheckpoint
            : null
          const completedSteps = new Set<FirstDraftStepId>(resumedCheckpoint?.completedSteps ?? [])
          const skippedSteps = new Set<FirstDraftStepId>(resumedCheckpoint?.skippedSteps ?? [])
          let chapterMemo: ChapterFirstDraftContextInput['chapterMemo'] | undefined = resumedCheckpoint?.chapterMemo
          let checkpointText = resumedCheckpoint?.currentText ?? ''
          let latestAuditResult: ChapterAuditPayload | null = resumedCheckpoint?.auditResult ?? null

          const persistInternalDocuments = async (documents: KnowledgeDocument[], errorPrefix: string): Promise<void> => {
            appStore.mergeKnowledgeDocuments(documents)
            await appStore.persistWorkspace()
            if (appStore.persistenceError) {
              throw new Error(`${errorPrefix}：${appStore.persistenceError}`)
            }
          }

          const now = new Date().toISOString()
          const existingContractDocument = appStore.knowledgeDocuments.find((document) =>
            document.sourceLabel === CHAPTER_CONTRACT_SOURCE_LABEL
            && String(document.metadata?.chapterId ?? '') === chapter.id
          )
          await persistInternalDocuments([{
            id: `chapter-contract-${chapter.id}`,
            projectId: project.id,
            title: `章节创作卡｜${chapter.title}`,
            sourceType: 'workflow-document',
            sourceLabel: CHAPTER_CONTRACT_SOURCE_LABEL,
            content: formatChapterWritingContractDocument(effectiveConfig.chapterContract),
            summary: effectiveConfig.chapterContract.goal || chapter.summary || '本章创作约束',
            keywords: [chapter.title, '章节创作卡'],
            metadata: {
              chapterId: chapter.id,
              sourceTitle: `chapter-contract:${chapter.id}`,
              contract: effectiveConfig.chapterContract,
              internal: true
            },
            createdAt: existingContractDocument?.createdAt || now,
            updatedAt: now
          }], '章节创作卡保存失败')

          const checkpointDocumentId = `chapter-draft-checkpoint-${chapter.id}`
          const existingCheckpointDocument = appStore.knowledgeDocuments.find((document) => document.id === checkpointDocumentId)
          const saveCheckpoint = async (): Promise<void> => {
            const updatedAt = new Date().toISOString()
            const checkpoint: FirstDraftCheckpoint = {
              version: 1,
              projectId: project.id,
              chapterId: chapter.id,
              updatedAt,
              configSignature,
              config: effectiveConfig,
              completedSteps: FIRST_DRAFT_STEP_DEFINITIONS
                .map((step) => step.id)
                .filter((stepId) => completedSteps.has(stepId)),
              skippedSteps: FIRST_DRAFT_STEP_DEFINITIONS
                .map((step) => step.id)
                .filter((stepId) => skippedSteps.has(stepId)),
              chapterMemo,
              currentText: checkpointText,
              auditResult: latestAuditResult
            }
            await persistInternalDocuments([{
              id: checkpointDocumentId,
              projectId: project.id,
              title: `初稿检查点｜${chapter.title}`,
              sourceType: 'workflow-document',
              sourceLabel: FIRST_DRAFT_CHECKPOINT_SOURCE_LABEL,
              content: JSON.stringify(checkpoint),
              summary: '内部恢复数据，不参与知识检索。',
              keywords: [],
              metadata: {
                chapterId: chapter.id,
                sourceTitle: `chapter-draft-checkpoint:${chapter.id}`,
                internal: true
              },
              createdAt: existingCheckpointDocument?.createdAt || updatedAt,
              updatedAt
            }], '初稿检查点保存失败')
          }
          const clearCheckpoint = async (): Promise<void> => {
            appStore.removeKnowledgeDocuments([checkpointDocumentId])
            await appStore.persistWorkspace()
            if (appStore.persistenceError) {
              throw new Error(`初稿完成，但检查点清理失败：${appStore.persistenceError}`)
            }
          }

          await saveCheckpoint()
          if (resumedCheckpoint) {
            executionLabel.value = `已恢复检查点，跳过 ${completedSteps.size} 个已完成步骤`
            updateProgress(Math.min(45, completedSteps.size * 9), '已恢复上次未完成的初稿流程')
          }
          const resolveStepSkillContext = (stepId: FirstDraftStepId) => {
            const step = steps[stepId]
            return {
              projectSkills: project.projectSkills ?? [],
              skillPolicy: {
                mode: step.skillMode,
                skillIds: step.skillMode === 'only' ? step.skillIds : []
              }
            }
          }
          const handleStepError = (stepId: FirstDraftStepId, error: unknown): void => {
            if (steps[stepId].failurePolicy === 'stop') {
              throw error instanceof Error ? error : new Error(`${steps[stepId].id} 执行失败`)
            }
          }
          const currentChapterIndex = appStore.chapters.findIndex((item) => item.id === chapter.id)
          const precedingChapters = appStore.chapters.slice(0, currentChapterIndex)
          const relatedChapters = precedingChapters
            .slice(-4)
            .map((item) => ({
              title: item.title,
              summary: item.summary,
              preview: getChapterPreviewText(item.content ?? '').slice(0, 800)
            }))
          const relatedTitles = new Set(relatedChapters.map((r) => r.title))
          const volumeChapterSummaries = precedingChapters
            .filter((c) => c.volumeId === chapter.volumeId && !relatedTitles.has(c.title))
            .map((c) => ({ title: c.title, summary: c.summary }))
          const firstChapter = appStore.chapters[0]
          const novelOpenerSummary =
            firstChapter && firstChapter.id !== chapter.id && !relatedTitles.has(firstChapter.title)
              ? { title: firstChapter.title, summary: firstChapter.summary }
              : undefined

          // L2 接续契约：取最近一个有正文的前序章节的「结尾」原文，让本章自然承接。
          // 注意取的是末尾 ~800 字（结尾），与 relatedChapters 的开头预览方向相反。
          const chaptersWithContent = precedingChapters.filter((c) => Boolean(getPlainTextFromEditorContent(c.content ?? '').trim()))
          const handoffChapter = chaptersWithContent.at(-1)
          const previousChapterHandoff = handoffChapter
            ? {
                title: handoffChapter.title,
                endingText: getPlainTextFromEditorContent(handoffChapter.content ?? '').trim().slice(-800)
              }
            : undefined

          // recentEndingsTrail 仅用于「避免连续相同收尾形式」；紧邻上一章已交给接续契约独占，从这里剔除，
          // 避免「请承接上一章结尾」与「避免与该结尾雷同」的指令冲突。
          const recentEndingsTrail = chaptersWithContent
            .slice(0, handoffChapter ? -1 : undefined)
            .slice(-3)
            .map((c) => {
              const plain = getPlainTextFromEditorContent(c.content ?? '').trim()
              const lastLine = plain.split('\n').map((s) => s.trim()).filter(Boolean).at(-1) ?? ''
              return {
                chapterTitle: c.title,
                endingLine: lastLine.length > 80 ? lastLine.slice(0, 77) + '...' : lastLine
              }
            })
            .filter((entry) => entry.endingLine)

          const volumeOutlineItems = appStore.outlineItems.filter((item) => item.volumeId === chapter.volumeId)
          const currentOutlineItem = chapter.outlineItemId
            ? volumeOutlineItems.find((item) => item.id === chapter.outlineItemId)
            : volumeOutlineItems.find((item) => item.title.trim() === chapter.title.trim())
          const currentChapterOutlineIndex = currentOutlineItem
            ? volumeOutlineItems.findIndex((item) => item.id === currentOutlineItem.id)
            : -1
          const outlineItemsForCurrentChapter = currentChapterOutlineIndex >= 0
            ? volumeOutlineItems.slice(Math.max(0, currentChapterOutlineIndex - 3), currentChapterOutlineIndex + 1)
            : volumeOutlineItems.slice(0, 6)
          const sameOutlineChapters = currentOutlineItem
            ? appStore.chapters.filter((c) =>
                c.outlineItemId === currentOutlineItem.id
                || (!c.outlineItemId && c.volumeId === currentOutlineItem.volumeId && c.title.trim() === currentOutlineItem.title.trim())
              )
            : []
          const currentOutlineChapterIndex = sameOutlineChapters.findIndex((c) => c.id === chapter.id)
          const previousSameOutlineChapters = currentOutlineChapterIndex >= 0
            ? sameOutlineChapters.slice(0, currentOutlineChapterIndex)
            : []
          const outlineChapterSplit = currentOutlineItem
            ? {
                currentPart: currentOutlineChapterIndex >= 0 ? currentOutlineChapterIndex + 1 : 1,
                totalParts: Math.max(sameOutlineChapters.length, 1),
                previousParts: previousSameOutlineChapters.map((c) => ({
                  title: c.title,
                  summary: c.summary,
                  preview: getChapterPreviewText(c.content ?? '').slice(0, 220)
                }))
              }
            : null

          const outlineItemContext = buildOutlineItemContext(currentOutlineItem, {
            characters: appStore.characters,
            organizations: appStore.organizations,
            worldviewEntries: appStore.worldviewEntries
          })
          const draftSkillContext = resolveStepSkillContext('draft')
          const writingPacket: Record<string, unknown> = buildChapterWritingPacket({
            project,
            chapter,
            chapterIndex: Math.max(currentChapterIndex, 0),
            chapterVolume,
            relatedChapters,
            volumeChapterSummaries,
            novelOpenerSummary,
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            inspirationEntries: appStore.inspirationEntries,
            currentOutlineItem: outlineItemContext,
            outlineChapterSplit,
            outlineItems: outlineItemsForCurrentChapter,
            plotThreads: appStore.plotThreads,
            knowledgeDocuments: appStore.projectConstraints,
            chapterContent: '',
            targetWordCount,
            userPrompt: '',
            chapterContract: effectiveConfig.chapterContract,
            ...draftSkillContext,
            recentEndingsTrail,
            previousChapterHandoff,
            referenceStyleContext: buildReferenceStyleContext(config.selectedReferenceWorkIds)
          })

          executionLabel.value = '检索相关章节与情节线索'
          recompute()
          await new Promise((r) => setTimeout(r, 0))

          const recentJournals = appStore.knowledgeDocuments
            .filter((d) => d.sourceLabel === 'writing-journal')
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .slice(0, 3)
          if (recentJournals.length > 0) {
            writingPacket.recentWritingJournals = recentJournals.map((j) => ({
              title: j.title,
              content: j.content
            }))
          }

          if (steps.memo.enabled && !completedSteps.has('memo') && !skippedSteps.has('memo')) {
            executionLabel.value = '正在流式生成写作备忘...'
            const memoHintTimer = setTimeout(() => {
              if (currentStreamTask.value === 'chapter-memo' && !previewContent.value) {
                executionLabel.value = 'AI 正在规划写作备忘，请稍候...'
              }
            }, 8000)

            try {
              const memoSkillContext = resolveStepSkillContext('memo')
              const memoStream = await streamTask('chapter-memo', {
                ...writingPacket,
                ...memoSkillContext,
                userPrompt: appendStepPrompt(config.userPrompt, steps.memo.userPrompt)
              })
              clearTimeout(memoHintTimer)
              const memoResult = memoStream.result as { memo?: ChapterFirstDraftContextInput['chapterMemo'] } | undefined
              if (memoResult?.memo) {
                chapterMemo = memoResult.memo
                completedSteps.add('memo')
                await saveCheckpoint()
              }
            } catch (error) {
              clearTimeout(memoHintTimer)
              executionLabel.value = '写作备忘生成失败，跳过直接写作...'
              if (steps.memo.failurePolicy === 'skip') {
                skippedSteps.add('memo')
                await saveCheckpoint()
              }
              handleStepError('memo', error)
            }
          } else if (steps.memo.enabled && chapterMemo) {
            previewTitle.value = '已恢复写作备忘'
            previewContent.value = formatMemoForRepair(chapterMemo)
            updateProgress(12, '已从检查点恢复写作备忘')
          } else if (steps.memo.enabled && skippedSteps.has('memo')) {
            updateProgress(12, '写作备忘已按失败策略跳过')
          }

          const context = {
            ...writingPacket,
            userPrompt: appendStepPrompt(`请生成这一章的完整初稿，目标字数为 ${targetWordCount} 字，这是本次生成的硬约束；请在完成剧情的同时主动控制篇幅。如果当前正文为空，就从零起稿；如果当前正文不为空，也按整章重写处理，而不是续写。${config.userPrompt ? `\n\n补充要求：${config.userPrompt}` : ''}`, steps.draft.userPrompt),
            ...draftSkillContext,
            chapterMemo
          }

          let fullText = completedSteps.has('draft') ? checkpointText : ''
          if (!fullText) {
            executionLabel.value = '构建写作提示词…'
            recompute()
            await new Promise((r) => setTimeout(r, 0))

            executionLabel.value = `正在生成本章初稿（目标约 ${targetWordCount} 字）…`
            isStreaming.value = true
            recompute()

            // 模型可能不支持流式输出（如 mimo 系列），10 秒后提示用户耐心等待
            const waitHintTimer = setTimeout(() => {
              if (currentStreamTask.value === 'chapter-first-draft' && !streamingContent.value) {
                executionLabel.value = `AI 正在创作中，请耐心等待（目标约 ${targetWordCount} 字）…`
              }
            }, 10000)

            try {
              const draftStream = await streamTask('chapter-first-draft', context)
              fullText = draftStream.text
            } finally {
              clearTimeout(waitHintTimer)
            }
            if (!fullText) throw new Error('AI 未返回有效章节正文。')
            checkpointText = fullText
            completedSteps.add('draft')
            await saveCheckpoint()
          } else {
            streamingContent.value = fullText
            streamingCharCount.value = fullText.length
            previewTitle.value = '已恢复章节初稿'
            previewContent.value = fullText
            updateProgress(50, '已从检查点恢复章节初稿')
          }

          if (fullText) {
            updateProgress(50, '初稿生成完成，准备进入后续检查...')
            let finalText = checkpointText || fullText

            if (!steps.audit.enabled) {
              const localAudit = buildLocalDraftAudit(finalText, targetWordCount)
              latestAuditResult = localAudit
              if (!localAudit.pass || localAudit.issues.length > 0) {
                auditResult.value = localAudit
                updateProgress(58, '本地检查完成；发现的问题留给你确认，不额外消耗 AI 额度')
              } else {
                updateProgress(60, '本地字数与重复段落检查通过')
              }
            }

            if (steps.audit.enabled && chapterMemo) {
              if (skippedSteps.has('audit')) {
                updateProgress(60, 'AI 深度审计已按失败策略跳过')
              } else if (completedSteps.has('audit') && latestAuditResult) {
                auditResult.value = latestAuditResult
                updateProgress(60, '已从检查点恢复章节审计结果')
              } else {
                executionLabel.value = '正在流式审计章节质量...'
                isAuditing.value = true
                try {
                  const auditSkillContext = resolveStepSkillContext('audit')
                  const auditStream = await streamTask('chapter-audit', {
                    projectId: project.id,
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    targetWordCount,
                    draftText: finalText,
                    measuredWordCount: finalText.trim().length,
                    chapterMemo,
                    ...auditSkillContext,
                    userPrompt: steps.audit.userPrompt
                  })
                  const auditResp = auditStream.result as { audit?: ChapterAuditPayload } | undefined
                  if (!auditResp?.audit) throw new Error('AI 未返回有效章节审计结果。')
                  latestAuditResult = normalizeAuditWordCount(
                    auditResp.audit,
                    targetWordCount,
                    finalText.trim().length
                  )
                  completedSteps.add('audit')
                  await saveCheckpoint()
                  auditResult.value = latestAuditResult
                } catch (error) {
                  if (steps.audit.failurePolicy === 'skip') {
                    skippedSteps.add('audit')
                    await saveCheckpoint()
                  }
                  handleStepError('audit', error)
                } finally {
                  isAuditing.value = false
                }
              }

              const criticalIssues = latestAuditResult?.issues.filter((issue) => issue.severity === 'critical') ?? []
              if (steps.repair.enabled && latestAuditResult && !latestAuditResult.pass && criticalIssues.length > 0) {
                if (skippedSteps.has('repair')) {
                  updateProgress(70, '自动修复已按失败策略跳过')
                } else if (completedSteps.has('repair') && checkpointText) {
                  finalText = checkpointText
                  updateProgress(70, '已从检查点恢复自动修复结果')
                } else {
                  auditResult.value = null
                  executionLabel.value = `审计发现 ${criticalIssues.length} 个关键问题，正在自动修复...`
                  updateProgress(60, `审计发现 ${criticalIssues.length} 个关键问题，准备自动修复...`)
                  try {
                    const repairSkillContext = resolveStepSkillContext('repair')
                    const repairStream = await streamTask('chapter-repair', {
                      projectId: project.id,
                      chapterTitle: chapter.title,
                      chapterSummary: chapter.summary,
                      chapterContent: finalText,
                      targetWordCount,
                      measuredWordCount: finalText.trim().length,
                      projectTitle: project.title,
                      projectGenre: project.genre,
                      writingStyleLabel: project.writingStylePresetId,
                      writingStylePrompt: project.writingStylePrompt,
                      auditIssues: criticalIssues,
                      chapterMemoText: formatMemoForRepair(chapterMemo),
                      ...repairSkillContext,
                      userPrompt: steps.repair.userPrompt
                    })
                    const repairedText = repairStream.text
                    if (!repairedText || repairedText.length <= finalText.length * 0.5) {
                      throw new Error('AI 返回的修复稿不完整，已保留检查点中的初稿。')
                    }
                    finalText = repairedText
                    checkpointText = repairedText
                    completedSteps.add('repair')
                    await saveCheckpoint()
                    executionLabel.value = `已自动修复 ${criticalIssues.length} 个问题`
                    updateProgress(70, `已自动修复 ${criticalIssues.length} 个问题`)
                  } catch (error) {
                    auditResult.value = latestAuditResult
                    if (steps.repair.failurePolicy === 'skip') {
                      skippedSteps.add('repair')
                      await saveCheckpoint()
                    }
                    handleStepError('repair', error)
                  }
                }
              } else if (latestAuditResult) {
                auditResult.value = latestAuditResult
                if (steps.repair.enabled) {
                  completedSteps.add('repair')
                  await saveCheckpoint()
                }
                updateProgress(
                  latestAuditResult.pass ? 60 : 59,
                  latestAuditResult.pass ? '章节审计通过' : '章节审计完成，未触发自动修复'
                )
              }
            }

            if (steps.humanize.enabled) {
              if (skippedSteps.has('humanize')) {
                updateProgress(90, '去 AI 味润色已按失败策略跳过')
              } else if (completedSteps.has('humanize') && checkpointText) {
                finalText = checkpointText
                updateProgress(90, '已从检查点恢复润色结果')
              } else {
                try {
                  executionLabel.value = '正在执行去 AI 味润色...'
                  const humanizeSkillContext = resolveStepSkillContext('humanize')
                  const humanizeStream = await streamTask('chapter-humanize', {
                    projectId: project.id,
                    chapterId: chapter.id,
                    projectTitle: project.title,
                    projectGenre: project.genre,
                    chapterTitle: chapter.title,
                    chapterSummary: chapter.summary,
                    writingStyleLabel: project.writingStylePresetId,
                    writingStylePrompt: project.writingStylePrompt,
                    sourceText: finalText,
                    ...humanizeSkillContext,
                    userPrompt: steps.humanize.userPrompt
                  })
                  const humanizedText = humanizeStream.text
                  if (!humanizedText || humanizedText.length <= finalText.length * 0.5) {
                    throw new Error('AI 返回的润色稿不完整，已保留检查点中的上一版本。')
                  }
                  finalText = humanizedText
                  checkpointText = humanizedText
                  completedSteps.add('humanize')
                  await saveCheckpoint()
                  executionLabel.value = '去 AI 味润色完成'
                  updateProgress(90, '去 AI 味润色完成')
                } catch (error) {
                  if (steps.humanize.failurePolicy === 'skip') {
                    skippedSteps.add('humanize')
                    await saveCheckpoint()
                  }
                  handleStepError('humanize', error)
                }
              }
            }

            finalText = finalCleanGeneratedChapterText(finalText)
            if (finalText) {
              checkpointText = finalText
              executionLabel.value = '正在写入最终章节'
              updateProgress(95, '正在写入最终章节...')
              appStore.updateChapter(chapter.id, {
                content: ensureEditorHtmlContent(finalText),
                status: 'review'
              })
              await appStore.persistWorkspace()
              if (appStore.persistenceError) {
                throw new Error(`初稿已生成，但保存失败：${appStore.persistenceError}`)
              }
            }

            if (steps['session-note'].enabled && !completedSteps.has('session-note') && !skippedSteps.has('session-note')) {
              try {
                const auditForNote = latestAuditResult ?? auditResult.value
                const auditSummary = auditForNote
                  ? (auditForNote.pass ? '通过' : `未通过，${auditForNote.issues.length} 个问题`)
                  : '未审计'
                updateProgress(99, '正在整理本地写作日志...')
                const referenceTitles = appStore.referenceWorks
                  .filter((work) => config.selectedReferenceWorkIds.includes(work.id))
                  .map((work) => work.title)
                const skillNames = (project.projectSkills ?? [])
                  .filter((skill) => steps.draft.skillIds.includes(skill.id))
                  .map((skill) => skill.name)
                const craftDecisions = chapterMemo?.currentTask
                  || steps.draft.userPrompt
                  || config.userPrompt
                  || '按本章大纲和项目设定完成正文'
                const effectiveReferences = [...referenceTitles, ...skillNames].join('、') || '项目大纲与故事资料'
                const nextChapterAdvice = chapterMemo?.endingChanges?.join('；')
                  || `承接《${chapter.title}》结尾，并优先处理尚未兑现的剧情目标。`
                const now = new Date().toISOString()
                appStore.mergeKnowledgeDocuments([{
                  id: `journal-${Date.now()}`,
                  projectId: project.id,
                  title: `写作日志｜${chapter.title}`,
                  sourceType: 'chapter-summary',
                  sourceLabel: 'writing-journal',
                  content: `创作决定：${craftDecisions}\n参考：${effectiveReferences}\n检查：${auditSummary}\n下章建议：${nextChapterAdvice}`,
                  summary: nextChapterAdvice,
                  keywords: [chapter.title, 'writing-journal'],
                  metadata: {
                    chapterId: chapter.id,
                    journalType: 'writing-journal',
                    generatedWithoutAi: true,
                    finalSource: completedSteps.has('humanize')
                      ? '润色稿'
                      : completedSteps.has('repair') ? '修复稿' : '初稿'
                  },
                  createdAt: now,
                  updatedAt: now
                }])
                await appStore.persistWorkspace()
                if (appStore.persistenceError) {
                  throw new Error(`写作日志保存失败：${appStore.persistenceError}`)
                }
                completedSteps.add('session-note')
                await saveCheckpoint()
              } catch (error) {
                if (steps['session-note'].failurePolicy === 'skip') {
                  skippedSteps.add('session-note')
                  await saveCheckpoint()
                }
                handleStepError('session-note', error)
              }
            }
            await clearCheckpoint()
            completed = true
          }
        }
      )
    } catch (error) {
      const isCanceled = error instanceof Error && error.message === 'canceled'
      if (isCanceled) {
        finalLabel = '本次 AI 初稿流程已停止'
        return false
      }
      finalLabel = '本次 AI 初稿流程失败'
      throw error
    } finally {
      reset(finalLabel)
    }
    return completed
  }

  async function stop(): Promise<void> {
    if (!streamId.value || isStopping.value) return
    isStopping.value = true
    const result = await window.characterArc.stopAiStream(streamId.value)
    if (!result.success) {
      if (isAlreadyStoppedStreamError(result.error ?? '')) {
        releaseCurrentStreamState()
        return
      }
      isStopping.value = false
      throw new Error(result.error ?? '停止 AI 初稿失败')
    }
  }

  function closeModal(): void {
    if (isGenerating.value) return
    modalVisible.value = false
    streamingContent.value = ''
    previewTitle.value = ''
    previewContent.value = ''
  }

  return {
    isGenerating,
    isStopping,
    modalVisible,
    streamingContent,
    streamingCharCount,
    reasoningContent,
    executionLabel,
    previewTitle,
    previewContent,
    progressPercent,
    progressText,
    auditResult,
    isAuditing,
    elapsedSeconds,
    isStreaming,
    start,
    stop,
    closeModal,
    registerStreamListener,
    unregisterStreamListener
  }
}
