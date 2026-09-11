/** 最后一轮仅用于整理已有证据，不再消耗新的宿主工具调用。 */
export function isCodexFinalizationRound(step: number, maxSteps: number): boolean {
  return step >= Math.max(1, maxSteps)
}

/** 防止复杂工具任务在达到轮数上限前已经累计消耗数十万输入 token。 */
export const CODEX_SOFT_PROMPT_TOKEN_LIMIT = 96_000

export function hasReachedCodexPromptBudget(promptTokens?: number): boolean {
  return Number.isFinite(promptTokens) && Number(promptTokens) >= CODEX_SOFT_PROMPT_TOKEN_LIMIT
}

export function buildCodexRoundInstruction(
  step: number,
  maxSteps: number,
  reason: 'step-limit' | 'token-budget' = 'step-limit'
): string {
  if (isCodexFinalizationRound(step, maxSteps) || reason === 'token-budget') {
    return [
      reason === 'token-budget'
        ? `【执行轮次】累计输入已达到本任务额度预算，本轮必须收尾（当前 ${step}/${maxSteps} 轮）。`
        : `【执行轮次】这是最后一轮（${step}/${maxSteps}）。`,
      '不得继续读取、搜索或调用任何工具；toolCalls 必须为空数组。',
      '请基于已有工具结果在 finalText 中完成回答。若资料仍不足，明确说明已确认的内容和下一步所需资料，不要继续扩读。'
    ].join('\n')
  }

  return [
    `【执行轮次】当前第 ${step}/${maxSteps} 轮。`,
    '每轮先判断现有证据是否已能完成用户任务；证据足够就停止扩读，直接回答或产出需要的暂存变更。',
    '用户已指定目标时，只读目标及完成任务不可缺少的直接上下文，不要遍历其他分页。'
  ].join('\n')
}

/**
 * 识别“试图返回宿主工具协议，但 JSON 语法已损坏”的文本。
 * 这类内容不能当作普通聊天正文透传给用户。
 */
export function looksLikeCodexToolProtocol(value: string): boolean {
  const text = String(value ?? '').trim()
  return text.includes('{')
    && /["']toolCalls["']\s*:/.test(text)
    && /["']finalText["']\s*:/.test(text)
}
