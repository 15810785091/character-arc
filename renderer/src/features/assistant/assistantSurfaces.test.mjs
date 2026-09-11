import assert from 'node:assert/strict'
import test from 'node:test'

import { GLOBAL_ASSISTANT_SURFACE } from './assistantSurfaces.ts'

test('全局助手 V2 保留 12 轮工具交互预算', () => {
  assert.equal(GLOBAL_ASSISTANT_SURFACE.maxSteps, 12)
})
