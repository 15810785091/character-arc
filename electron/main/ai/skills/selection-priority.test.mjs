import assert from 'node:assert/strict'
import test from 'node:test'
import { selectSkillCandidates } from './selection-priority.ts'
import { findSkillDefinitionByIdOrName } from './registry-merge.ts'

function entry(id, name, total, required = false) {
  return {
    skill: {
      id,
      name,
      manifest: { required }
    },
    breakdown: { total }
  }
}

const compare = (a, b) => b.breakdown.total - a.breakdown.total

test('自动模式中用户点名的 Skill 不会被高分候选和数量上限挤掉', () => {
  const entries = [
    entry('humanizer-zh', 'humanizer-zh', 20, true),
    entry('novel-pacing', 'novel-pacing', 15),
    entry('novel-emotion', 'novel-emotion', 14),
    entry('novel-language-style', 'novel-language-style', 13),
    entry('novel-polishing', 'novel-polishing', 12),
    entry('novel-pleasure-points', 'novel-pleasure-points', 11),
    entry('我吃西红柿笔锋', '我吃西红柿笔锋', 0)
  ]

  const selected = selectSkillCandidates(
    entries,
    '继续创作章节，写作优先使用我吃西红柿笔锋',
    6,
    compare
  )

  assert.equal(selected.length, 6)
  assert.ok(selected.some((item) => item.skill.id === '我吃西红柿笔锋'))
  assert.ok(selected.some((item) => item.skill.id === 'humanizer-zh'))
})

test('显示名称与目录 ID 不同时，点名显示名称也能优先并被工具解析', () => {
  const named = entry('fiction-human-texture', '我吃西红柿笔锋', 0)
  const selected = selectSkillCandidates([named], '请优先使用我吃西红柿笔锋', 4, compare)
  assert.equal(selected[0]?.skill.id, 'fiction-human-texture')
  assert.equal(
    findSkillDefinitionByIdOrName([named.skill], '我吃西红柿笔锋')?.id,
    'fiction-human-texture'
  )
})
