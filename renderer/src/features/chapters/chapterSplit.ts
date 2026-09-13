import type { ChapterDraft } from '@/types/app'

export const MIN_CHAPTER_SPLIT_COUNT = 2
export const MAX_CHAPTER_SPLIT_COUNT = 6

export interface ChapterSplitPlanPart {
  title: string
  content: string
  characterCount: number
  paragraphStart: number
  paragraphEnd: number
  wordTarget: string
}

export interface ChapterSplitPlan {
  sourceChapterId: string
  sourceContent: string
  paragraphCount: number
  parts: ChapterSplitPlanPart[]
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const HTML_ENTITY_MAP: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"
}

function findTagEnd(html: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function readTag(token: string): { name: string; closing: boolean; selfClosing: boolean } | null {
  if (/^<!--|^<!doctype|^<\?/.test(token.toLowerCase())) return null
  const match = token.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/i)
  if (!match) return null
  const name = match[2].toLowerCase()
  return {
    name,
    closing: Boolean(match[1]),
    selfClosing: /\/\s*>$/.test(token) || VOID_TAGS.has(name)
  }
}

/** 将 TipTap HTML 拆成顶层块；每个块始终保持完整标签和行内格式。 */
function extractTopLevelBlocks(content: string): string[] {
  const html = content.trim()
  if (!html) return []
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return html
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
  }

  const blocks: string[] = []
  let cursor = 0
  while (cursor < html.length) {
    while (cursor < html.length && /\s/.test(html[cursor])) cursor += 1
    if (cursor >= html.length) break
    if (html[cursor] !== '<') {
      const nextTag = html.indexOf('<', cursor)
      const end = nextTag === -1 ? html.length : nextTag
      const text = html.slice(cursor, end).trim()
      if (text) blocks.push(`<p>${escapeHtml(text)}</p>`)
      cursor = end
      continue
    }

    const blockStart = cursor
    const stack: string[] = []
    do {
      if (html.startsWith('<!--', cursor)) {
        const commentEnd = html.indexOf('-->', cursor + 4)
        cursor = commentEnd === -1 ? html.length : commentEnd + 3
        continue
      }
      const tagEnd = findTagEnd(html, cursor)
      if (tagEnd === -1) {
        cursor = html.length
        break
      }
      const token = html.slice(cursor, tagEnd + 1)
      const tag = readTag(token)
      if (tag) {
        if (tag.closing) {
          const matchIndex = stack.lastIndexOf(tag.name)
          if (matchIndex >= 0) stack.splice(matchIndex)
        } else if (!tag.selfClosing) {
          stack.push(tag.name)
        }
      }
      cursor = tagEnd + 1
      if (stack.length > 0) {
        const nextTag = html.indexOf('<', cursor)
        cursor = nextTag === -1 ? html.length : nextTag
      }
    } while (stack.length > 0 && cursor < html.length)
    blocks.push(html.slice(blockStart, cursor))
  }
  return blocks.filter(Boolean)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function visibleCharacterCount(html: string): number {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/((?:p|div|h[1-6]|blockquote|li))>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&([^;]+);/g, (match, entity) => HTML_ENTITY_MAP[entity] ?? match)
    .replace(/\r/g, '')
    .trim()
  return text.length
}

function splitTitle(title: string, partCount: number, partIndex: number): string {
  const suffix = partCount === 2
    ? ['上', '下'][partIndex]
    : partCount === 3
      ? ['上', '中', '下'][partIndex]
      : `${partIndex + 1}/${partCount}`
  return `${title.trim() || '未命名章节'}（${suffix}）`
}

function distributeWordTargets(sourceTarget: string, weights: number[]): string[] {
  const digits = sourceTarget.replace(/\D/g, '')
  const totalTarget = Number.parseInt(digits || '3000', 10)
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  let assigned = 0
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return String(Math.max(1, totalTarget - assigned))
    const next = Math.max(1, Math.round(totalTarget * weight / totalWeight))
    assigned += next
    return String(next)
  })
}

function selectCutOrdinals(weights: number[], partCount: number): number[] {
  const total = weights.reduce((sum, value) => sum + value, 0)
  const cumulative: number[] = []
  weights.reduce((sum, value, index) => {
    cumulative[index] = sum + value
    return cumulative[index]
  }, 0)

  const cuts: number[] = []
  let previous = 0
  for (let part = 1; part < partCount; part += 1) {
    const minOrdinal = previous + 1
    const maxOrdinal = weights.length - (partCount - part)
    const target = total * part / partCount
    let bestOrdinal = minOrdinal
    let bestDistance = Number.POSITIVE_INFINITY
    for (let ordinal = minOrdinal; ordinal <= maxOrdinal; ordinal += 1) {
      const distance = Math.abs(cumulative[ordinal - 1] - target)
      if (distance < bestDistance) {
        bestOrdinal = ordinal
        bestDistance = distance
      }
    }
    cuts.push(bestOrdinal)
    previous = bestOrdinal
  }
  return cuts
}

/** 规划章节拆分；结果中的每一部分都是连续且完整的顶层段落块。 */
export function planChapterSplit(chapter: ChapterDraft, partCount: number): ChapterSplitPlan {
  if (!Number.isInteger(partCount) || partCount < MIN_CHAPTER_SPLIT_COUNT || partCount > MAX_CHAPTER_SPLIT_COUNT) {
    throw new Error(`拆分数量必须是 ${MIN_CHAPTER_SPLIT_COUNT} 到 ${MAX_CHAPTER_SPLIT_COUNT} 之间的整数。`)
  }

  const blocks = extractTopLevelBlocks(chapter.content)
  const visibleBlocks = blocks
    .map((content, blockIndex) => ({ blockIndex, characterCount: visibleCharacterCount(content) }))
    .filter((block) => block.characterCount > 0)
  if (visibleBlocks.length < partCount) {
    throw new Error(`本章只有 ${visibleBlocks.length} 个有效段落，无法拆成 ${partCount} 章。`)
  }

  const cuts = selectCutOrdinals(visibleBlocks.map((block) => block.characterCount), partCount)
  const ranges = [...cuts, visibleBlocks.length]
  let previousBlockIndex = 0
  let previousVisibleOrdinal = 0
  const rawParts = ranges.map((visibleEndOrdinal) => {
    const isLast = visibleEndOrdinal === visibleBlocks.length
    const blockEnd = isLast ? blocks.length : visibleBlocks[visibleEndOrdinal - 1].blockIndex + 1
    const content = blocks.slice(previousBlockIndex, blockEnd).join('')
    const part = {
      content,
      characterCount: visibleCharacterCount(content),
      paragraphStart: previousVisibleOrdinal + 1,
      paragraphEnd: visibleEndOrdinal
    }
    previousBlockIndex = blockEnd
    previousVisibleOrdinal = visibleEndOrdinal
    return part
  })
  const wordTargets = distributeWordTargets(chapter.wordTarget, rawParts.map((part) => part.characterCount))

  return {
    sourceChapterId: chapter.id,
    sourceContent: chapter.content,
    paragraphCount: visibleBlocks.length,
    parts: rawParts.map((part, index) => ({
      ...part,
      title: splitTitle(chapter.title, partCount, index),
      wordTarget: wordTargets[index]
    }))
  }
}

/** 将仍然有效的计划实体化为章节；第一部分保留原章节 ID。 */
export function materializeChapterSplit(
  chapter: ChapterDraft,
  plan: ChapterSplitPlan,
  createChapterId: () => string
): ChapterDraft[] {
  if (chapter.id !== plan.sourceChapterId || chapter.content !== plan.sourceContent) {
    throw new Error('章节正文在预览后已发生变化，请重新打开拆分预览。')
  }
  return plan.parts.map((part, index) => ({
    ...chapter,
    id: index === 0 ? chapter.id : createChapterId(),
    title: part.title,
    wordTarget: part.wordTarget,
    content: part.content
  }))
}
