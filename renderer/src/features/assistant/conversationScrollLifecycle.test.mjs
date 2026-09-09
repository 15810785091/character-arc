import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const components = [
  '../../components/assistantV2/AssistantMessages.vue',
  '../../components/chapterWorkspace/ChapterAiMessages.vue',
  '../../components/GlobalAssistantPanel.vue',
  '../../components/GlobalAssistantPage.vue'
]

for (const relativePath of components) {
  test(`${relativePath} 重新显示已有对话时回到底部`, async () => {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')

    assert.match(source, /function restoreConversationPosition\s*\([^)]*\)[^{]*\{[\s\S]*?scrollToBottom\s*\(/)
    assert.match(source, /onMounted\s*\(\s*restoreConversationPosition\s*\)/)
    assert.match(source, /onActivated\s*\(\s*restoreConversationPosition\s*\)/)
  })
}
