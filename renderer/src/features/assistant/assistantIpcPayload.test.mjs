import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ref } from 'vue'

test('Vue Skill 策略必须在调用 ContextBridge 前转换为可克隆载荷', async () => {
  const reactivePolicy = ref({ mode: 'auto', skillIds: [] }).value
  assert.throws(() => structuredClone(reactivePolicy), /could not be cloned/)

  const plainPolicy = JSON.parse(JSON.stringify(reactivePolicy))
  assert.deepEqual(structuredClone(plainPolicy), { mode: 'auto', skillIds: [] })

  const source = await readFile(new URL('../../composables/useAssistant.ts', import.meta.url), 'utf8')
  assert.match(source, /A\.turnSend\(toIpcPayload\(\{/)
})
