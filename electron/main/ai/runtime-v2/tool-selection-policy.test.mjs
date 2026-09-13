import assert from 'node:assert/strict'
import test from 'node:test'

import { selectToolsForTurn } from './tool-selection-policy.ts'

const surface = { id: 'global-page', scope: 'project', autoCommit: false, maxSteps: 12 }
const tools = [
  'read_project_data', 'search_project', 'skill_load', 'stage_character', 'stage_worldview',
  'stage_outline', 'stage_outline_volume', 'stage_chapter_create', 'stage_chapter_edit', 'stage_organization',
  'stage_organization_membership', 'knowledge_save_document'
].map((name) => ({ definition: { name } }))

test('人物设定修改只暴露读取、技能和人物相关写工具', () => {
  const selected = selectToolsForTurn(tools, {
    surface,
    intent: 'entity-edit',
    userMessage: '修改人物唐烈，并调整他所属学院'
  }).map((tool) => tool.definition.name)

  assert.ok(selected.includes('read_project_data'))
  assert.ok(selected.includes('skill_load'))
  assert.ok(selected.includes('stage_character'))
  assert.ok(selected.includes('stage_organization'))
  assert.ok(selected.includes('stage_organization_membership'))
  assert.ok(!selected.includes('stage_worldview'))
  assert.ok(!selected.includes('stage_outline'))
  assert.ok(!selected.includes('stage_chapter_create'))
})

test('无法预判类型的录入任务保留全部暂存工具', () => {
  const selected = selectToolsForTurn(tools, {
    surface,
    intent: 'ingest',
    userMessage: '把下面这批草稿录入项目'
  }).map((tool) => tool.definition.name)

  assert.ok(selected.includes('stage_character'))
  assert.ok(selected.includes('stage_worldview'))
  assert.ok(selected.includes('stage_outline'))
})

test('未写明实体类型的修改请求不会丢失暂存能力', () => {
  const selected = selectToolsForTurn(tools, {
    surface,
    intent: 'chat',
    userMessage: '把唐烈改得冷酷一点'
  }).map((tool) => tool.definition.name)

  assert.ok(selected.includes('stage_character'))
  assert.ok(selected.includes('stage_worldview'))
  assert.ok(selected.includes('stage_outline'))
})

test('修改大纲时同时暴露大纲节点与分卷暂存工具', () => {
  const selected = selectToolsForTurn(tools, {
    surface,
    intent: 'entity-edit',
    userMessage: '修改当前项目的大纲和分卷结构'
  }).map((tool) => tool.definition.name)

  assert.ok(selected.includes('stage_outline'))
  assert.ok(selected.includes('stage_outline_volume'))
})
