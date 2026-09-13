import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChapterWordCountIssue } from './chapter-audit-policy.ts'

test('章节字数不足目标九成时返回关键问题', () => {
  const issue = buildChapterWordCountIssue(3000, 2600)
  assert.equal(issue?.category, 'word-count')
  assert.match(issue?.hint ?? '', /补足约 100 字/)
})

test('章节超过目标字数不属于审计问题', () => {
  assert.equal(buildChapterWordCountIssue(3000, 6000), null)
})
