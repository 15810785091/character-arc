export interface OutlineCardSource {
  summary?: string
  conflict?: string
}

export interface OutlineCardPresentation {
  /** 卡片的主要剧情描述。 */
  summary: string
  /** 与主要描述不重复时，作为次要信息展示的核心冲突。 */
  conflict: string
}

/**
 * 将大纲表单字段转成外层卡片文案。
 * 剧情描述是用户在编辑器中维护的主内容，应当优先显示；历史数据缺少 summary 时才回退到 conflict。
 */
export function resolveOutlineCardPresentation(source: OutlineCardSource): OutlineCardPresentation {
  const summary = String(source.summary ?? '').trim()
  const conflict = String(source.conflict ?? '').trim()

  if (!summary) {
    return { summary: conflict, conflict: '' }
  }

  return {
    summary,
    conflict: conflict && conflict !== summary ? conflict : ''
  }
}
