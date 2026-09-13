import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../../components/assistantV2/GlobalAssistantV2Panel.vue', import.meta.url),
  'utf8'
)
const stagedChangesSource = readFileSync(
  new URL('../../components/assistantV2/StagedChangesView.vue', import.meta.url),
  'utf8'
)
const chapterAssistantSource = readFileSync(
  new URL('../../components/chapterWorkspace/ChapterAiPanelV2.vue', import.meta.url),
  'utf8'
)

test('全局助手沉浸态固定为历史、对话、暂存三栏', () => {
  assert.match(source, /grid-template-areas:\s*['"]sessions chat staged['"]/)
  assert.match(source, /\.v2-dock\.expanded \.sessions-pane\s*{[^}]*grid-area:\s*sessions/s)
  assert.match(source, /\.v2-dock\.expanded \.chat-pane\s*{[^}]*grid-area:\s*chat/s)
  assert.match(source, /\.v2-dock\.expanded \.staged-pane\s*{[^}]*grid-area:\s*staged/s)
})

test('窄窗口沉浸态仍保持对话在左、暂存在右', () => {
  assert.match(source, /grid-template-areas:\s*['"]chat staged['"]/) 
})

test('全局与章节助手共用可放大的暂存审阅工作台', () => {
  assert.match(source, /<StagedChangesView/)
  assert.match(chapterAssistantSource, /<StagedChangesView/)
  assert.match(stagedChangesSource, /<Teleport to="body"/)
  assert.match(stagedChangesSource, /isReviewMaximized/)
  assert.match(stagedChangesSource, /reviewDisplayMode === 'diff'/)
  assert.match(stagedChangesSource, /写回 \$\{acceptedCount\} 项/)
})
