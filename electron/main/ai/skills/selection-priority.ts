type CandidateSkill = {
  id: string
  name: string
  manifest: { required?: boolean }
}

export type PrioritizedSkillCandidate = {
  skill: CandidateSkill
  breakdown: { total: number }
}

function normalizeMention(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

/** 用户在自然语言中明确写出 Skill ID 或显示名称时，视为主动点名。 */
export function isSkillExplicitlyMentioned(skill: CandidateSkill, userPrompt: string): boolean {
  const prompt = normalizeMention(userPrompt)
  if (!prompt) return false
  return [skill.id, skill.name]
    .map(normalizeMention)
    .filter((value) => value.length >= 2)
    .some((value) => prompt.includes(value))
}

/**
 * 自动模式候选选择：required 与用户点名项优先保留，剩余名额再按评分填充。
 * 点名项不受普通候选数量上限挤压；若点名/必选项本身超过上限，则全部保留。
 */
export function selectSkillCandidates<T extends PrioritizedSkillCandidate>(
  entries: T[],
  userPrompt: string,
  maxSkills: number,
  compare: (a: T, b: T) => number
): T[] {
  const decorated = entries.map((entry) => ({
    entry,
    pinned: entry.skill.manifest.required === true || isSkillExplicitlyMentioned(entry.skill, userPrompt)
  }))
  const eligible = decorated.filter(({ entry, pinned }) => entry.breakdown.total > 0 || pinned)
  const pinned = eligible.filter((item) => item.pinned).map((item) => item.entry).sort(compare)
  const optional = eligible.filter((item) => !item.pinned).map((item) => item.entry).sort(compare)
  return [...pinned, ...optional.slice(0, Math.max(0, maxSkills - pinned.length))]
}
