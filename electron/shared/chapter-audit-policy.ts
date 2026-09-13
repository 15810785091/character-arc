export type ChapterWordCountIssue = {
  severity: 'critical'
  category: 'word-count'
  ref: string
  hint: string
}

/** 长章允许后续拆分；只有低于目标 90% 才属于章节审计失败。 */
export function buildChapterWordCountIssue(
  targetWordCount: number,
  measuredWordCount: number
): ChapterWordCountIssue | null {
  const target = Math.max(Number(targetWordCount) || 0, 1)
  const measured = Math.max(Number(measuredWordCount) || 0, 0)
  const minimum = Math.round(target * 0.9)
  if (measured >= minimum) return null

  return {
    severity: 'critical',
    category: 'word-count',
    ref: `程序测量 ${measured} 字，目标 ${target} 字，最低建议 ${minimum} 字`,
    hint: `正文低于目标下限，需要补足约 ${minimum - measured} 字，并优先扩展关键冲突、行动和情绪转折。`
  }
}
