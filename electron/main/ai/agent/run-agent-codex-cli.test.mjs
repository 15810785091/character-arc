import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseCodexToolEnvelope } from './codex-tool-bridge.ts'
import { runAgent } from './run-agent.ts'

const codexSettings = {
  provider: 'codex-cli',
  model: 'default',
  apiKey: '',
  baseUrl: '',
  codexReasoningEffort: 'default',
  embeddingModel: '',
  imageModel: '',
  imageApiKey: '',
  imageBaseUrl: ''
}

test('Codex CLI 可通过宿主工具生成暂存变更，重复调用不会重复写入', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-codex-agent-'))
  const executable = join(directory, 'fake-codex')
  const toolResponse = JSON.stringify({
    toolCalls: [{
      name: 'stage_worldview',
      arguments: {
        action: 'create',
        type: '地理',
        title: '北境冻原',
        content: '终年覆盖寒冰。',
        reason: '录入用户提供的世界观草稿'
      }
    }, {
      name: 'stage_worldview',
      arguments: {
        action: 'create',
        type: '地理',
        title: '北境冻原',
        content: '终年覆盖寒冰。',
        reason: '录入用户提供的世界观草稿'
      }
    }],
    finalText: ''
  })
  const finalResponse = JSON.stringify({
    toolCalls: [],
    finalText: '已生成待审阅的世界观变更。'
  })
  const script = [
    '#!/usr/bin/env node',
    "let prompt = ''",
    "process.stdin.on('data', (chunk) => { prompt += chunk })",
    `process.stdin.on('end', () => {`,
    `  const bridgeEnabled = prompt.includes('"name":"stage_worldview"') && !prompt.includes('进程内工具不可用')`,
    `  const text = !bridgeEnabled`,
    `    ? JSON.stringify({ toolCalls: [], finalText: '宿主工具桥未启用。' })`,
    `    : prompt.includes('change_id=change-1') ? ${JSON.stringify(finalResponse)} : ${JSON.stringify(toolResponse)}`,
    `  const event = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })`,
    `  console.log(event)`,
    `  console.log(event)`,
    `  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 8 } }))`,
    '})'
  ].join('\n')
  await writeFile(executable, script, 'utf8')
  await chmod(executable, 0o755)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })

  const calls = []
  const events = []
  const result = await runAgent({
    settings: { ...codexSettings, codexCliPath: executable },
    systemPrompt: '录入模式：把草稿拆成暂存变更。',
    userPrompt: '北境冻原终年覆盖寒冰。',
    tools: [{
      definition: {
        name: 'stage_worldview',
        description: '暂存世界观变更。',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['action', 'type', 'title', 'content', 'reason']
        }
      },
      handler: async (input) => {
        calls.push(input)
        return { content: '已暂存世界观新增（change_id=change-1）。尚未写回，需用户确认。' }
      }
    }],
    ctx: { signal: new AbortController().signal, projectId: 'project-1' },
    handlers: {
      onTextDelta: (delta) => events.push(['text', delta]),
      onReasoningDelta: (delta) => events.push(['reasoning', delta]),
      onToolUseStart: (id, name, args) => events.push(['tool-start', id, name, args]),
      onToolResult: (id, name, content, isError) => events.push(['tool-result', id, name, content, isError]),
      onAgentStatus: (message) => events.push(['status', message]),
      onEditApplied() {},
      onEditProposed() {}
    },
    maxSteps: 4
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].title, '北境冻原')
  assert.equal(result.toolCalls.length, 2)
  assert.equal(result.toolCalls[0].tool, 'stage_worldview')
  assert.equal(result.finalText, '已生成待审阅的世界观变更。')
  assert.ok(events.some((event) => event[0] === 'tool-start'))
  assert.ok(events.some((event) => event[0] === 'tool-result'))
})

test('Codex 宿主工具协议兼容 JSON 代码块，普通聊天文本不会被误解析', () => {
  assert.deepEqual(
    parseCodexToolEnvelope('```json\n{"toolCalls":[],"finalText":"完成"}\n```'),
    { toolCalls: [], finalText: '完成' }
  )
  assert.equal(parseCodexToolEnvelope('这是普通聊天回复。'), null)
  assert.equal(parseCodexToolEnvelope('{"title":"用户要求的 JSON 内容"}'), null)
})

test('Codex CLI 重复返回相同协议 JSON 时仍能解析工具调用', () => {
  const response = '{"toolCalls":[{"name":"read_chapter","arguments":{"chapter_id":"chapter-1"}}],"finalText":""}'
  assert.deepEqual(parseCodexToolEnvelope(response + response), {
    toolCalls: [{ name: 'read_chapter', arguments: { chapter_id: 'chapter-1' } }],
    finalText: ''
  })
})

test('Codex CLI 连续返回多个有效协议 JSON 时采用最后一个结果', () => {
  const first = '{"toolCalls":[{"name":"read_chapter","arguments":{"chapter_id":"chapter-1"}}],"finalText":""}'
  const latest = '{"toolCalls":[{"name":"read_chapter","arguments":{"chapter_id":"chapter-2"}}],"finalText":""}'
  assert.deepEqual(parseCodexToolEnvelope(first + latest), {
    toolCalls: [{ name: 'read_chapter', arguments: { chapter_id: 'chapter-2' } }],
    finalText: ''
  })
})
