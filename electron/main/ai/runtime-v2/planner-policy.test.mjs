import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuntimePlan } from './planner.ts'

const surface = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}

test('全项目任务使用可续批的项目级读取预算', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请完整审计整个项目的所有设定'
    }
  })

  assert.equal(plan.enforceToolBudgets, true)
  assert.equal(plan.requiresBatching, true)
  assert.equal(plan.maxReadToolCalls, 8)
  assert.equal(plan.maxSearchToolCalls, 3)
})

test('普通项目任务限制扩读，但不强制分批', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '基于最新一章继续创作下一章'
    }
  })

  assert.equal(plan.enforceToolBudgets, true)
  assert.equal(plan.requiresBatching, false)
  assert.equal(plan.maxReadToolCalls, 6)
  assert.equal(plan.maxSearchToolCalls, 3)
  assert.ok(plan.contextProviders.includes('project-digest'))
})

test('人物修改只预载明确相关资料域，不再把全部项目模块塞入提示词', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '修改人物唐烈的人设和所属学院'
    }
  })

  assert.ok(plan.contextProviders.includes('project-digest'))
  assert.ok(plan.contextProviders.includes('characters'))
  assert.ok(plan.contextProviders.includes('organizations'))
  assert.ok(!plan.contextProviders.includes('worldview'))
  assert.ok(!plan.contextProviders.includes('outline'))
})
