import type { ProjectWorkspaceSnapshot } from './providers/shared'

export const IMPACT_WARNINGS_PAYLOAD_KEY = '__impactWarnings'

export function attachImpactWarnings(
  payload: Record<string, unknown>,
  warnings: readonly string[]
): Record<string, unknown> {
  const normalized = [...new Set(warnings.map((item) => item.trim()).filter(Boolean))]
  return normalized.length
    ? { ...payload, [IMPACT_WARNINGS_PAYLOAD_KEY]: normalized }
    : payload
}

export function readImpactWarnings(payload: Record<string, unknown> | undefined): string[] {
  const value = payload?.[IMPACT_WARNINGS_PAYLOAD_KEY]
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
}

export function buildDeleteImpactWarnings(
  workspace: ProjectWorkspaceSnapshot,
  kind: 'worldview' | 'character' | 'organization' | 'outline',
  entityId: string
): string[] {
  if (kind === 'outline') {
    const chapters = workspace.chapters.filter((chapter) => chapter.outlineItemId === entityId)
    return chapters.length
      ? [`该大纲仍被 ${chapters.length} 个章节绑定：${chapters.slice(0, 4).map((item) => `《${item.title}》`).join('、')}。删除后章节不会被删除，但会失去大纲关联。`]
      : []
  }

  const outlineField = kind === 'character'
    ? 'relatedCharacterIds'
    : kind === 'organization' ? 'relatedOrganizationIds' : 'relatedWorldviewIds'
  const outlines = workspace.outlineItems.filter((item) => (item[outlineField] ?? []).includes(entityId))
  const warnings: string[] = []
  if (outlines.length) {
    warnings.push(`仍有 ${outlines.length} 个大纲引用此${kind === 'character' ? '人物' : kind === 'organization' ? '组织' : '设定'}：${outlines.slice(0, 4).map((item) => `《${item.title}》`).join('、')}。`)
  }

  if (kind === 'character') {
    const relationships = workspace.characterRelationships.filter((item) =>
      item.fromCharacterId === entityId || item.toCharacterId === entityId
    )
    const memberships = workspace.organizationMemberships.filter((item) => item.characterId === entityId)
    if (relationships.length) warnings.push(`此人物还有 ${relationships.length} 条人物关系，删除后这些关系会成为无效引用。`)
    if (memberships.length) warnings.push(`此人物还有 ${memberships.length} 条组织归属，删除后这些归属会成为无效引用。`)
  }

  if (kind === 'organization') {
    const memberships = workspace.organizationMemberships.filter((item) => item.organizationId === entityId)
    if (memberships.length) warnings.push(`此组织还有 ${memberships.length} 名成员，删除后这些归属会成为无效引用。`)
  }

  return warnings
}

export function buildOutlineUpdateImpactWarnings(input: {
  previousSummary: string
  nextSummary: string
  previousConflict: string
  nextConflict: string
}): string[] {
  const summaryChanged = input.previousSummary.trim() !== input.nextSummary.trim()
  const conflictUnchanged = input.previousConflict.trim() === input.nextConflict.trim()
  if (!summaryChanged || !conflictUnchanged || !input.previousConflict.trim()) return []
  return ['剧情摘要已改变，但核心冲突仍与修改前完全相同。请确认旧冲突仍适用；若新剧情没有冲突，应将其清空。']
}
