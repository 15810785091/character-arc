import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveOptionalOutlineText,
  validateOutlineNarrativeUpdate
} from './outline-update-policy.ts'

test('手动编辑允许用空字符串删除旧的核心冲突', () => {
  assert.equal(resolveOptionalOutlineText('旧冲突', undefined), '旧冲突')
  assert.equal(resolveOptionalOutlineText('旧冲突', '   '), '')
  assert.equal(resolveOptionalOutlineText('旧冲突', '  新冲突  '), '新冲突')
})

test('AI 修改剧情描述时必须显式决定保留、更新或清空冲突', () => {
  assert.match(
    validateOutlineNarrativeUpdate({ action: 'update', summary: '新的剧情描述' }) ?? '',
    /必须同时提供 conflict/
  )
  assert.equal(
    validateOutlineNarrativeUpdate({ action: 'update', summary: '新的剧情描述', conflict: '' }),
    null
  )
  assert.equal(validateOutlineNarrativeUpdate({ action: 'update', conflict: '新冲突' }), null)
})
