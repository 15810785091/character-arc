import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveEnhanceTagLabel } from './enhancePreview.ts'

test('AI 补充建议保留实体 ID 作为采纳值，但向用户展示实体名称', () => {
  const labels = {
    'character-45259879-a7bc-4860-8f8f-39340f640785': '亚伦·罗兰 · 主角',
    'organization-ab85cceb-d80c-4f40-bf9d-45fd01e09de1': '罗兰家族 · 贵族'
  }

  assert.equal(
    resolveEnhanceTagLabel('character-45259879-a7bc-4860-8f8f-39340f640785', labels),
    '亚伦·罗兰 · 主角'
  )
  assert.equal(
    resolveEnhanceTagLabel('organization-ab85cceb-d80c-4f40-bf9d-45fd01e09de1', labels),
    '罗兰家族 · 贵族'
  )
  assert.equal(resolveEnhanceTagLabel('unknown-id', labels), '未知条目（unknown-id）')
})

test('大纲建议把三类实体名称映射传给通用预览弹窗', () => {
  const outlineSource = readFileSync(new URL('../../components/OutlinePanel.vue', import.meta.url), 'utf8')
  const previewSource = readFileSync(new URL('../../components/AiEnhancePreview.vue', import.meta.url), 'utf8')

  assert.match(outlineSource, /relatedCharacterIds[\s\S]{0,300}tagLabels: buildEnhanceTagLabels\(characterOptions\.value\)/)
  assert.match(outlineSource, /relatedOrganizationIds[\s\S]{0,300}tagLabels: buildEnhanceTagLabels\(organizationOptions\.value\)/)
  assert.match(outlineSource, /relatedWorldviewIds[\s\S]{0,300}tagLabels: buildEnhanceTagLabels\(worldviewOptions\.value\)/)
  assert.match(previewSource, /resolveEnhanceTagLabel\(t, field\.tagLabels\)/)
})
