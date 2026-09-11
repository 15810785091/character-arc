import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildToolProtocolPrompt, parseCodexToolEnvelope } from './codex-tool-bridge.ts'
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

test('Codex CLI 工具轮使用同一 session 续接，后续只发送新增结果', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-codex-resume-'))
  const executable = join(directory, 'fake-codex')
  const traceFile = join(directory, 'trace.jsonl')
  const firstResponse = JSON.stringify({
    toolCalls: [{ name: 'read_project_data', arguments: { entity_type: 'outline' } }],
    finalText: ''
  })
  const finalResponse = JSON.stringify({ toolCalls: [], finalText: '已根据大纲完成分析。' })
  const script = [
    '#!/usr/bin/env node',
    "const { appendFileSync } = require('node:fs')",
    "let prompt = ''",
    "process.stdin.on('data', (chunk) => { prompt += chunk })",
    "process.stdin.on('end', () => {",
    `  appendFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ args: process.argv.slice(2), prompt }) + '\\n')`,
    "  const resumed = process.argv.includes('resume')",
    `  const text = resumed ? ${JSON.stringify(finalResponse)} : ${JSON.stringify(firstResponse)}`,
    "  if (!resumed) console.log(JSON.stringify({ type: 'thread.started', thread_id: '0199-session-id' }))",
    "  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }))",
    "  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }))",
    '})'
  ].join('\n')
  await writeFile(executable, script, 'utf8')
  await chmod(executable, 0o755)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })

  const result = await runAgent({
    settings: { ...codexSettings, codexCliPath: executable },
    systemPrompt: '读取必要资料后回答。',
    userPrompt: '分析当前大纲。',
    tools: [{
      definition: {
        name: 'read_project_data',
        description: '读取项目资料。',
        inputSchema: { type: 'object', properties: { entity_type: { type: 'string' } } }
      },
      handler: async () => ({ content: '唯一的新大纲资料。' })
    }],
    ctx: { signal: new AbortController().signal, projectId: 'project-1' },
    handlers: {
      onTextDelta() {},
      onReasoningDelta() {},
      onToolUseStart() {},
      onToolResult() {},
      onAgentStatus() {},
      onEditApplied() {},
      onEditProposed() {}
    },
    maxSteps: 4
  })

  const traces = (await readFile(traceFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(traces.length, 2)
  assert.ok(!traces[0].args.includes('resume'))
  assert.deepEqual(traces[1].args.slice(-2), ['0199-session-id', '-'])
  assert.ok(traces[0].prompt.includes('读取必要资料后回答。'))
  assert.ok(traces[1].prompt.includes('唯一的新大纲资料。'))
  assert.ok(!traces[1].prompt.includes('读取必要资料后回答。'))
  assert.equal(result.finalText, '已根据大纲完成分析。')
})

test('Codex 宿主工具协议兼容 JSON 代码块，普通聊天文本不会被误解析', () => {
  assert.deepEqual(
    parseCodexToolEnvelope('```json\n{"toolCalls":[],"finalText":"完成"}\n```'),
    { toolCalls: [], finalText: '完成' }
  )
  assert.equal(parseCodexToolEnvelope('这是普通聊天回复。'), null)
  assert.equal(parseCodexToolEnvelope('{"title":"用户要求的 JSON 内容"}'), null)
})

test('Codex 宿主工具目录压缩冗长说明，但保留参数结构', () => {
  const prompt = buildToolProtocolPrompt([{
    definition: {
      name: 'stage_worldview',
      description: `暂存世界观。${'长说明'.repeat(300)}`,
      inputSchema: {
        type: 'object',
        title: '冗余标题',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update'],
            description: `动作说明${'冗余'.repeat(200)}`
          }
        },
        required: ['action']
      }
    },
    handler: async () => ({ content: '' })
  }])

  assert.match(prompt, /stage_worldview/)
  assert.match(prompt, /"enum":\["create","update"\]/)
  assert.match(prompt, /"required":\["action"\]/)
  assert.ok(!prompt.includes('冗余标题'))
  assert.ok(prompt.length < 1_600)
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

test('Codex CLI 在最后一轮禁止继续调用工具并强制收尾', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-codex-finalize-'))
  const executable = join(directory, 'fake-codex')
  const script = [
    '#!/usr/bin/env node',
    "let prompt = ''",
    "process.stdin.on('data', (chunk) => { prompt += chunk })",
    "process.stdin.on('end', () => {",
    "  const finalRound = prompt.includes('这是最后一轮')",
    "  const text = finalRound",
    "    ? JSON.stringify({ toolCalls: [], finalText: '已根据已读取资料整理结果。' })",
    "    : JSON.stringify({ toolCalls: [{ name: 'read_project_data', arguments: { entity_type: 'outline' } }], finalText: '' })",
    "  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }))",
    "  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }))",
    '})'
  ].join('\n')
  await writeFile(executable, script, 'utf8')
  await chmod(executable, 0o755)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })

  let readCount = 0
  const result = await runAgent({
    settings: { ...codexSettings, codexCliPath: executable },
    systemPrompt: '读取必要资料后回答。',
    userPrompt: '继续创作章节。',
    tools: [{
      definition: {
        name: 'read_project_data',
        description: '读取项目资料。',
        inputSchema: { type: 'object', properties: { entity_type: { type: 'string' } } }
      },
      handler: async () => {
        readCount += 1
        return { content: '已返回大纲资料。' }
      }
    }],
    ctx: { signal: new AbortController().signal, projectId: 'project-1' },
    handlers: {
      onTextDelta() {},
      onReasoningDelta() {},
      onToolUseStart() {},
      onToolResult() {},
      onAgentStatus() {},
      onEditApplied() {},
      onEditProposed() {}
    },
    maxSteps: 3
  })

  // 前两轮请求相同，宿主复用首次结果，不重复读库。
  assert.equal(readCount, 1)
  assert.equal(result.toolCalls.length, 2)
  assert.equal(result.iterations, 3)
  assert.equal(result.finalText, '已根据已读取资料整理结果。')
})

test('Codex CLI 的损坏工具 JSON 不显示给用户，而是自动要求重试', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-codex-protocol-retry-'))
  const executable = join(directory, 'fake-codex')
  const malformed = '{"toolCalls":[{"name":"read_project_data","arguments":{"entity_type":"outline","entity_id":"outline-1}}],"finalText":""}'
  const finalResponse = JSON.stringify({ toolCalls: [], finalText: '协议已修复，任务继续完成。' })
  const script = [
    '#!/usr/bin/env node',
    "let prompt = ''",
    "process.stdin.on('data', (chunk) => { prompt += chunk })",
    "process.stdin.on('end', () => {",
    `  const text = prompt.includes('上一轮返回的工具协议 JSON 格式错误') ? ${JSON.stringify(finalResponse)} : ${JSON.stringify(malformed)}`,
    "  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }))",
    "  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }))",
    '})'
  ].join('\n')
  await writeFile(executable, script, 'utf8')
  await chmod(executable, 0o755)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })

  const visibleText = []
  const result = await runAgent({
    settings: { ...codexSettings, codexCliPath: executable },
    systemPrompt: '使用宿主工具。',
    userPrompt: '读取大纲。',
    tools: [{
      definition: { name: 'read_project_data', description: '读取项目资料。', inputSchema: { type: 'object' } },
      handler: async () => ({ content: '大纲资料。' })
    }],
    ctx: { signal: new AbortController().signal, projectId: 'project-1' },
    handlers: {
      onTextDelta: (delta) => visibleText.push(delta),
      onReasoningDelta() {},
      onToolUseStart() {},
      onToolResult() {},
      onAgentStatus() {},
      onEditApplied() {},
      onEditProposed() {}
    },
    maxSteps: 3
  })

  assert.deepEqual(visibleText, ['协议已修复，任务继续完成。'])
  assert.equal(result.finalText, '协议已修复，任务继续完成。')
})
