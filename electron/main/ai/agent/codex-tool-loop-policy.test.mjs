import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCodexRoundInstruction,
  hasReachedCodexPromptBudget,
  isCodexFinalizationRound,
  looksLikeCodexToolProtocol
} from './codex-tool-loop-policy.ts'

test('仅把最后一轮作为强制收尾轮', () => {
  assert.equal(isCodexFinalizationRound(11, 12), false)
  assert.equal(isCodexFinalizationRound(12, 12), true)
})

test('最后一轮明确要求停止读取并返回最终结果', () => {
  const instruction = buildCodexRoundInstruction(12, 12)
  assert.match(instruction, /这是最后一轮/)
  assert.match(instruction, /toolCalls 必须为空数组/)
  assert.match(instruction, /不得继续读取/)
})

test('非最后一轮提醒证据足够就停止扩读', () => {
  assert.match(buildCodexRoundInstruction(4, 12), /证据足够就停止扩读/)
})

test('累计输入达到预算时提前进入强制收尾轮', () => {
  assert.equal(hasReachedCodexPromptBudget(95_999), false)
  assert.equal(hasReachedCodexPromptBudget(96_000), true)
  assert.match(buildCodexRoundInstruction(5, 12, 'token-budget'), /额度预算/)
  assert.match(buildCodexRoundInstruction(5, 12, 'token-budget'), /toolCalls 必须为空数组/)
})

test('识别少一个引号的损坏工具协议，避免当作普通正文显示', () => {
  const malformed = '{"toolCalls":[{"name":"read_project_data","arguments":{"entity_type":"outline","entity_id":"outline-312c2f6b-8f0e-4a10-bbfe-778b98780da2}}],"finalText":""}'
  assert.equal(looksLikeCodexToolProtocol(malformed), true)
  assert.equal(looksLikeCodexToolProtocol('这是一段普通的中文回答。'), false)
  assert.equal(looksLikeCodexToolProtocol('{"title":"用户要求的 JSON 正文"}'), false)
})
