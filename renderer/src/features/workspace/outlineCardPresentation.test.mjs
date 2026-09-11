import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveOutlineCardPresentation } from './outlineCardPresentation.ts'

test('大纲卡片优先展示用户在“剧情描述”中保存的新内容', () => {
  assert.deepEqual(
    resolveOutlineCardPresentation({ conflict: '旧的核心冲突', summary: '修改后的剧情描述' }),
    {
      summary: '修改后的剧情描述',
      conflict: '旧的核心冲突'
    }
  )
})

test('历史节点没有剧情描述时仍可回退展示核心冲突', () => {
  assert.deepEqual(
    resolveOutlineCardPresentation({ conflict: '仅有核心冲突', summary: '' }),
    {
      summary: '仅有核心冲突',
      conflict: ''
    }
  )
})
