export type EnhanceTagLabels = Record<string, string>

/**
 * AI 建议内部继续携带稳定 ID，预览层只负责把 ID 转成可读名称。
 * 提供了映射但实体已经不存在时，明确标记为未知，避免用户误把 ID 当名称。
 */
export function resolveEnhanceTagLabel(value: unknown, labels?: EnhanceTagLabels): string {
  const key = String(value ?? '').trim()
  if (!labels) return key
  return labels[key] || `未知条目（${key || '空值'}）`
}

export function buildEnhanceTagLabels(
  options: ReadonlyArray<{ value?: unknown; label?: unknown }>
): EnhanceTagLabels {
  return Object.fromEntries(options.flatMap((option) => {
    const value = String(option.value ?? '').trim()
    const label = String(option.label ?? '').trim()
    return value && label ? [[value, label]] : []
  }))
}
