import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCodexHostToolName } from './codex-tool-name.ts'

const availableNames = new Set(['stage_outline_volume', 'stage_outline'])

test('Codex 返回 Markdown 转义的下划线时仍匹配已发布的宿主工具', () => {
  assert.equal(
    resolveCodexHostToolName('stage\\_outline\\_volume', availableNames),
    'stage_outline_volume'
  )
})

test('不会把目录外的相似名称映射为宿主工具', () => {
  assert.equal(resolveCodexHostToolName('stage-outline-volume', availableNames), null)
  assert.equal(resolveCodexHostToolName('stage_other_tool', availableNames), null)
})
