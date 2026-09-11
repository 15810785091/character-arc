/**
 * recent-messages · 最近的 turn 对话（用户输入 + 助手回复）。
 *
 * 让 AI 感知本会话的历史上下文；不是无限历史，只取最近 N 条。
 * 依赖 ConversationManager 而非 workspace snapshot。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import type { ConversationManager } from '../conversation-manager'
import { buildConversationMemory } from '../context-memory'
import { makeSlice } from './shared'

export function makeRecentMessagesProvider(
  getConversation: () => Promise<ConversationManager>
): ContextProvider {
  return {
    id: 'recent-messages',
    priority: 80,
    truncationHint: '最近对话历史因预算受限省略。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const cm = await getConversation()
      const turns = cm.listTurns(request.sessionId)
      // 排除当前正在执行的 turn（status='streaming'），只保留 done 状态的历史
      const history = turns.filter((t) => t.status === 'done')
      if (history.length === 0) return null

      return makeSlice(
        'recent-messages',
        80,
        `对话工作记忆（共 ${history.length} 轮）`,
        buildConversationMemory(history)
      )
    }
  }
}
