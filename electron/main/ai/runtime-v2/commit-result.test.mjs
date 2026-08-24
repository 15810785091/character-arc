import assert from 'node:assert/strict'
import test from 'node:test'
import { enrichCommitResult, finalizeCommitBatch } from './commit-result.ts'

test('章节内容变化时返回可理解的冲突说明', () => {
  const result = enrichCommitResult({
    changeId: 'change-stale',
    ok: false,
    error: '章节正文在暂存后已发生变化，请重新生成修改提案。'
  })

  assert.equal(result.errorCode, 'STALE_DATA')
  assert.equal(result.retryable, false)
  assert.match(result.message, /避免覆盖/)
  assert.match(result.suggestion, /重新生成/)
})

test('业务写入成功后快照刷新失败不会改判为失败', async () => {
  const results = await finalizeCommitBatch(
    [{ changeId: 'change-ok', ok: true, entityId: 'world-1' }],
    () => { throw new Error('broadcast failed') }
  )

  assert.equal(results[0].ok, true)
  assert.equal(results[0].entityId, 'world-1')
  assert.match(results[0].warning, /已经写入/)
})

test('批量提交只刷新一次工作区快照', async () => {
  let refreshCount = 0
  const results = await finalizeCommitBatch(
    [
      { changeId: 'change-a', ok: true },
      { changeId: 'change-b', ok: true },
      { changeId: 'change-c', ok: false, error: '目标不存在' }
    ],
    () => { refreshCount += 1 }
  )

  assert.equal(refreshCount, 1)
  assert.equal(results[2].errorCode, 'TARGET_NOT_FOUND')
})
