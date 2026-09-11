import type { WorkspacePayload } from '../../workspace-types'

type ProjectRecord = WorkspacePayload['projects'][number]
type ProjectWorkspace = WorkspacePayload['workspaces'][string]
type KnowledgeDocument = WorkspacePayload['knowledgeDocuments'][number]

export interface ConversationTurnLike {
  userMessage: string
  assistantMessage: string
}

const RECENT_TURNS = 6
const RECENT_MESSAGE_CHARS = 900
const OLDER_TURNS = 12
const OLDER_MESSAGE_CHARS = 160

function compactText(value: string, maxChars: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/**
 * 对话级工作记忆：近期保真、较早轮次只保留决策线索。
 * 这是确定性压缩，不额外调用模型，也不会改写用户原意。
 */
export function buildConversationMemory(turns: readonly ConversationTurnLike[]): string {
  if (turns.length === 0) return ''
  const recent = turns.slice(-RECENT_TURNS)
  const older = turns.slice(Math.max(0, turns.length - RECENT_TURNS - OLDER_TURNS), -RECENT_TURNS)
  const sections: string[] = []

  if (older.length > 0) {
    sections.push('### 较早对话索引（已压缩）')
    for (const turn of older) {
      sections.push(`- 用户：${compactText(turn.userMessage, OLDER_MESSAGE_CHARS)}`)
      if (turn.assistantMessage.trim()) {
        sections.push(`  助理：${compactText(turn.assistantMessage, OLDER_MESSAGE_CHARS)}`)
      }
    }
  }

  sections.push('### 最近对话')
  for (const turn of recent) {
    sections.push(`**用户**：${compactText(turn.userMessage, RECENT_MESSAGE_CHARS)}`)
    if (turn.assistantMessage.trim()) {
      sections.push(`**助理**：${compactText(turn.assistantMessage, RECENT_MESSAGE_CHARS)}`)
    }
    sections.push('')
  }
  return sections.join('\n').trim()
}

function stripHtml(value: string): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

function isPlaceholder(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return !compact || /待AI生成/.test(compact) || compact.length < 12
}

/**
 * 书籍级项目小结：从结构化项目数据实时派生，永远不覆盖用户的创作记忆。
 * 小结只负责定位与进度；需要精确事实时仍由 read/search 工具读取源实体。
 */
export function buildProjectDigest(params: {
  project: ProjectRecord
  workspace: ProjectWorkspace
  knowledgeDocuments: readonly KnowledgeDocument[]
  scopeRef?: string
}): string {
  const { project, workspace } = params
  const volumes = new Map(workspace.outlineVolumes.map((volume) => [volume.id, volume]))
  const requestedChapterId = params.scopeRef?.match(/^(?:chapter|selection):([^#]+)/)?.[1] ?? ''
  const currentChapter = workspace.chapters.find((chapter) => chapter.id === requestedChapterId)
    ?? workspace.chapters.at(-1)
  const activeVolume = currentChapter?.volumeId
    ? volumes.get(currentChapter.volumeId)
    : workspace.outlineVolumes[0]
  const orderedOutline = workspace.outlineItems.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const writtenOutlineIds = new Set(workspace.chapters.map((chapter) => chapter.outlineItemId).filter(Boolean))
  const currentOutline = currentChapter?.outlineItemId
    ? orderedOutline.find((item) => item.id === currentChapter.outlineItemId)
    : undefined
  const currentOutlineIndex = currentOutline ? orderedOutline.findIndex((item) => item.id === currentOutline.id) : -1
  const upcomingOutline = orderedOutline
    .slice(currentOutlineIndex >= 0 ? currentOutlineIndex + 1 : 0)
    .filter((item) => !writtenOutlineIds.has(item.id))
    .slice(0, 5)
  const recentChapters = workspace.chapters.slice(-5)
  const openThreads = workspace.plotThreads.filter((thread) => thread.status === 'open').slice(0, 6)

  const relatedCharacterIds = new Set<string>()
  for (const item of [currentOutline, ...upcomingOutline.slice(0, 2)]) {
    for (const id of item?.relatedCharacterIds ?? []) relatedCharacterIds.add(id)
  }
  const relatedCharacters = workspace.characters.filter((character) => relatedCharacterIds.has(character.id))
  const protagonistCharacters = workspace.characters.filter((character) => (
    !relatedCharacterIds.has(character.id) && /(主角|主人公)/.test(character.role)
  ))
  const prioritizedCharacterIds = new Set([
    ...relatedCharacters.map((character) => character.id),
    ...protagonistCharacters.map((character) => character.id)
  ])
  const selectedCharacters = [
    ...relatedCharacters,
    ...protagonistCharacters,
    ...workspace.characters.filter((character) => !prioritizedCharacterIds.has(character.id))
  ].slice(0, 8)

  const constraints = params.knowledgeDocuments
    .filter((doc) => (doc.projectId ?? '') === project.id)
    .filter((doc) => doc.sourceType === 'canon-fact' && doc.sourceLabel === 'global-constraint')
    .slice(0, 6)

  const workflowDocs = [
    ...(activeVolume?.workflowDocuments ?? []).map((doc) => ({ ...doc, scope: activeVolume?.title ?? '当前分卷' })),
    ...(workspace.workflowDocuments ?? []).map((doc) => ({ ...doc, scope: '项目' }))
  ]
    .filter((doc) => ['current_status', 'task_plan', 'progress'].includes(doc.key))
    .filter((doc) => !isPlaceholder(doc.content))
    .slice(0, 4)

  const totalChars = workspace.chapters.reduce((sum, chapter) => sum + stripHtml(chapter.content).length, 0)
  const lines: string[] = [
    `- 项目：**${project.title}**${project.genre ? `｜题材：${project.genre}` : ''}${project.targetPlatform ? `｜平台：${project.targetPlatform}` : ''}`,
    `- 规模：${workspace.chapters.length} 章｜正文约 ${totalChars.toLocaleString('zh-CN')} 字｜${workspace.outlineItems.length} 个大纲节点`,
    `- 资料索引：人物 ${workspace.characters.length}｜世界观 ${workspace.worldviewEntries.length}｜组织 ${workspace.organizations.length}｜未收束线索 ${workspace.plotThreads.filter((item) => item.status === 'open').length}`,
    activeVolume ? `- 当前分卷：【${activeVolume.title}】${compactText(activeVolume.summary, 280)}` : '',
    currentChapter
      ? `- 当前进度：【${currentChapter.title}】（${currentChapter.status}）${currentChapter.summary ? `：${compactText(currentChapter.summary, 320)}` : ''}`
      : '- 当前进度：尚未创建章节。'
  ].filter(Boolean)

  if (recentChapters.length > 0) {
    lines.push('', '### 最近章节')
    for (const chapter of recentChapters) {
      lines.push(`- 【${chapter.title}】（${chapter.status}）${chapter.summary ? `：${compactText(chapter.summary, 220)}` : ''}`)
    }
  }
  if (upcomingOutline.length > 0) {
    lines.push('', '### 接下来尚未成章的大纲')
    for (const item of upcomingOutline) {
      lines.push(`- 【${item.title}】${item.conflict ? `｜冲突：${compactText(item.conflict, 160)}` : ''}：${compactText(item.summary, 260)}`)
    }
  }
  if (selectedCharacters.length > 0) {
    lines.push('', '### 当前相关人物索引')
    for (const character of selectedCharacters) {
      lines.push(`- ${character.name}${character.role ? `（${character.role}）` : ''}：${compactText(character.description, 180)}`)
    }
  }
  if (openThreads.length > 0) {
    lines.push('', '### 未收束线索')
    for (const thread of openThreads) {
      lines.push(`- 【${thread.title}】：${compactText(thread.description, 180)}`)
    }
  }
  if (constraints.length > 0) {
    lines.push('', '### 项目硬约束索引')
    for (const doc of constraints) {
      lines.push(`- 【${doc.title}】：${compactText(doc.summary || doc.content, 220)}`)
    }
  }
  if (workflowDocs.length > 0) {
    lines.push('', '### 已维护的创作记忆摘要')
    for (const doc of workflowDocs) {
      lines.push(`- ${doc.scope} / ${doc.title}：${compactText(doc.content, 260)}`)
    }
  }

  lines.push('', '> 这是自动派生的小结，仅用于定位。修改前应按实体 ID 读取源资料，不得用小结覆盖源数据。')
  return lines.join('\n')
}
