import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentBehaviorRules } from './system-prompt.ts'
import { buildAssistantSystemPrompt } from '../runtime-v2/system-prompt.ts'

const surface = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}

test('Runtime v2 要求最终回复和可见推理都使用简体中文', () => {
  const prompt = buildAssistantSystemPrompt({ surface, contextBlock: '' })

  assert.match(prompt, /最终回复.*可见.*(?:分析|推理)过程.*简体中文/)
})

test('通用 Agent 规则要求可见推理使用简体中文', () => {
  assert.match(buildAgentBehaviorRules(), /最终回复.*可见.*(?:分析|推理)过程.*简体中文/)
})
