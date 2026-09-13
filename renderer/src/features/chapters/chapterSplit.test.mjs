import assert from 'node:assert/strict'
import test from 'node:test'

import { materializeChapterSplit, planChapterSplit } from './chapterSplit.ts'

function chapter(content, overrides = {}) {
  return {
    id: 'chapter-12',
    outlineItemId: 'outline-12',
    volumeId: 'volume-1',
    title: '第12章：钟楼回声',
    summary: '钟楼里的秘密被揭开。',
    status: 'final',
    wordTarget: '6000',
    content,
    ...overrides
  }
}

test('只在完整顶层段落之间拆分并原样保留富文本', () => {
  const content = [
    '<p>第一段<strong>加粗</strong>内容。</p>',
    '<p>第二段内容较长一些。</p>',
    '<blockquote><p>第三段引用内容。</p></blockquote>',
    '<p>第四段内容。</p>',
    '<ul><li><p>第五段列表内容。</p></li></ul>',
    '<p>第六段结尾。</p>'
  ].join('')
  const plan = planChapterSplit(chapter(content), 3)

  assert.equal(plan.parts.length, 3)
  assert.equal(plan.parts.map((part) => part.content).join(''), content)
  assert.deepEqual(plan.parts.map((part) => [part.paragraphStart, part.paragraphEnd]), [[1, 2], [3, 4], [5, 6]])
  assert.match(plan.parts[0].content, /<strong>加粗<\/strong>/)
  assert.match(plan.parts[1].content, /<blockquote><p>第三段引用内容。<\/p><\/blockquote>/)
  assert.match(plan.parts[2].content, /<ul><li><p>第五段列表内容。<\/p><\/li><\/ul>/)
})

test('按累计正文长度均衡且目标字数总和保持不变', () => {
  const content = '<p>甲甲甲甲甲</p><p>乙</p><p>丙丙丙丙</p><p>丁丁</p>'
  const plan = planChapterSplit(chapter(content, { wordTarget: '4000' }), 2)

  assert.equal(plan.parts[0].paragraphEnd, 2)
  assert.equal(plan.parts.reduce((sum, part) => sum + Number(part.wordTarget), 0), 4000)
})

test('实体化时第一部分保留原 ID，其余章节生成新 ID且不改动后续章号', () => {
  const source = chapter('<p>第一段</p><p>第二段</p><p>第三段</p>')
  const plan = planChapterSplit(source, 3)
  let id = 0
  const result = materializeChapterSplit(source, plan, () => `new-${++id}`)

  assert.deepEqual(result.map((item) => item.id), ['chapter-12', 'new-1', 'new-2'])
  assert.deepEqual(result.map((item) => item.title), [
    '第12章：钟楼回声（上）',
    '第12章：钟楼回声（中）',
    '第12章：钟楼回声（下）'
  ])
  assert.ok(result.every((item) => item.outlineItemId === 'outline-12' && item.volumeId === 'volume-1'))
})

test('有效段落不足或预览后正文变化时拒绝拆分', () => {
  assert.throws(() => planChapterSplit(chapter('<p>只有一段。</p>'), 2), /只有 1 个有效段落/)
  const source = chapter('<p>第一段</p><p>第二段</p>')
  const plan = planChapterSplit(source, 2)
  assert.throws(
    () => materializeChapterSplit({ ...source, content: `${source.content}<p>新段落</p>` }, plan, () => 'new'),
    /预览后已发生变化/
  )
})
