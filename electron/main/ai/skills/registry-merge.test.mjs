import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeSkillDefinitions } from './registry-merge.ts'

function skill({ id, name, content, scope = 'project' }) {
  return {
    id,
    name,
    version: '',
    path: `project-skills/${id}`,
    scope,
    rootDir: `/tmp/${id}`,
    description: '同一份技能说明',
    source: '',
    manifest: { category: 'writing', tasks: [], stages: ['draft'], triggers: [], priority: 50, references: [] },
    compatibility: 'native',
    compatibilityNote: '',
    enabled: true,
    referencesCount: 0,
    referenceFiles: [],
    content
  }
}

test('全局中文版 Skill 优先，并合并仅 name 不同的历史项目副本', () => {
  const body = '\n正文规则完全相同。\n'
  const shared = [skill({
    id: '写作润色',
    name: '我吃西红柿笔锋',
    content: `---\nname: 我吃西红柿笔锋\ndescription: 同一份技能说明\n---\n${body}`
  })]
  const project = [
    skill({
      id: 'fiction-human-texture',
      name: 'fiction-human-texture',
      content: `---\nname: fiction-human-texture\ndescription: 同一份技能说明\n---\n${body}`
    }),
    skill({
      id: '写作润色',
      name: 'fiction-human-texture',
      content: `---\nname: fiction-human-texture\ndescription: 同一份技能说明\n---\n${body}`
    })
  ]

  const merged = mergeSkillDefinitions(shared, project)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, '写作润色')
  assert.equal(merged[0].name, '我吃西红柿笔锋')
})

test('内容不同的项目 Skill 仍会保留', () => {
  const shared = [skill({ id: '全局技能', name: '全局技能', content: '全局正文' })]
  const project = [skill({ id: '项目技能', name: '项目技能', content: '不同正文' })]
  assert.deepEqual(mergeSkillDefinitions(shared, project).map((item) => item.id), ['全局技能', '项目技能'])
})
