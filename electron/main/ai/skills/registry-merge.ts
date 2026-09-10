import type { SkillDefinition } from './types'

/**
 * 生成不受展示名称影响的 Skill 内容标识。
 * 旧版导入可能只改了 frontmatter 的 name 或目录名，正文规则实际完全相同。
 */
export function resolveSkillContentIdentity(skill: SkillDefinition): string {
  const lines = String(skill.content ?? '').replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() === '---') {
    const closingIndex = lines.slice(1).findIndex((line) => line.trim() === '---')
    if (closingIndex >= 0) {
      const frontmatterEnd = closingIndex + 1
      for (let index = 1; index < frontmatterEnd; index += 1) {
        if (/^\s*name\s*:/i.test(lines[index] ?? '')) lines[index] = ''
      }
    }
  }
  return lines.map((line) => line.trimEnd()).join('\n').trim()
}

/**
 * 合并全局与项目注册表。全局条目优先；历史项目副本若仅目录名或展示名不同，
 * 会按内容标识折叠，避免在项目设置中出现英文旧名和重复项。
 */
export function mergeSkillDefinitions(
  sharedSkills: Iterable<SkillDefinition>,
  projectSkills: Iterable<SkillDefinition>
): SkillDefinition[] {
  const result: SkillDefinition[] = []
  const seenIds = new Set<string>()
  const seenContent = new Set<string>()

  const append = (skill: SkillDefinition): void => {
    const contentIdentity = resolveSkillContentIdentity(skill)
    if (seenIds.has(skill.id) || (contentIdentity && seenContent.has(contentIdentity))) return
    seenIds.add(skill.id)
    if (contentIdentity) seenContent.add(contentIdentity)
    result.push(skill)
  }

  for (const skill of sharedSkills) append(skill)
  for (const skill of projectSkills) append(skill)
  return result
}

/** 按规范 ID 查找，找不到时兼容唯一的显示名称。 */
export function findSkillDefinitionByIdOrName<T extends { id: string; name: string }>(
  skills: Iterable<T>,
  idOrName: string
): T | undefined {
  const entries = Array.from(skills)
  const key = idOrName.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  const exactId = entries.find((skill) => skill.id.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') === key)
  if (exactId) return exactId
  const nameMatches = entries.filter((skill) => skill.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') === key)
  return nameMatches.length === 1 ? nameMatches[0] : undefined
}
