function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * 合并可清空的大纲文本字段。
 * undefined 表示本次未修改；空字符串表示用户明确删除。
 */
export function resolveOptionalOutlineText(currentValue: string, nextValue: unknown): string {
  return nextValue === undefined ? currentValue : String(nextValue ?? '').trim()
}

/**
 * AI 更新剧情描述时，必须同时对核心冲突做出显式决定。
 * conflict 可以传新值、传原值表示保留，或传空字符串表示删除。
 */
export function validateOutlineNarrativeUpdate(input: Record<string, unknown>): string | null {
  if (input.action !== 'update' || !hasOwn(input, 'summary') || hasOwn(input, 'conflict')) {
    return null
  }

  return 'update 修改 summary 时必须同时提供 conflict：根据新剧情更新冲突；若无冲突则传空字符串；确认原冲突仍适用时传回原值。'
}
