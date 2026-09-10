import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeSkillUsePolicy } from '../../../shared/assistant-runtime.ts'

test('Skill 策略规范化支持自动、仅使用和不使用三态', () => {
  assert.deepEqual(normalizeSkillUsePolicy(undefined), { mode: 'auto', skillIds: [] })
  assert.deepEqual(normalizeSkillUsePolicy({ mode: 'only', skillIds: ['a', 'a', '', ' b '] }), {
    mode: 'only',
    skillIds: ['a', 'b']
  })
  assert.deepEqual(normalizeSkillUsePolicy({ mode: 'off', skillIds: ['a'] }), {
    mode: 'off',
    skillIds: ['a']
  })
})

test('Skill 工具统一在解析入口校验本轮执行授权', () => {
  const source = readFileSync(new URL('../agent/tools/skill-tools.ts', import.meta.url), 'utf8')
  assert.match(source, /opts\.allowSkillUse\?\.\(skill\) \?\? enabled/)
  assert.match(source, /当前执行策略不允许使用 skill/)
})
