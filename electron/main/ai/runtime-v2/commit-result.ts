import type { StagedChangeCommitResult } from '@shared/assistant-runtime'

function failureDetails(error: string): Pick<
  StagedChangeCommitResult,
  'errorCode' | 'message' | 'suggestion' | 'retryable'
> {
  const normalized = error.toLowerCase()

  if (error.includes('暂存后已发生变化')) {
    return {
      errorCode: 'STALE_DATA',
      message: '目标内容在提案生成后又被修改。为避免覆盖你的新内容，本次没有写回。',
      suggestion: '请忽略这条旧提案，并让 AI 基于最新内容重新生成。',
      retryable: false
    }
  }
  if (error.includes('同名') || normalized.includes('duplicate') || normalized.includes('unique constraint')) {
    return {
      errorCode: 'DUPLICATE',
      message: '项目中已经存在同名或相同内容，本次没有重复新增。',
      suggestion: '请忽略这条新增提案，或改为修改已有条目。',
      retryable: false
    }
  }
  if (error.includes('sessionId') || normalized.includes('session')) {
    return {
      errorCode: 'SESSION_NOT_FOUND',
      message: '当前助手会话已经失效，无法确认提案所属项目。',
      suggestion: '请重新打开项目或切换会话后再试。',
      retryable: true
    }
  }
  if (
    error.includes('不存在') || error.includes('已删除') || error.includes('找不到') ||
    normalized.includes('not found')
  ) {
    return {
      errorCode: 'TARGET_NOT_FOUND',
      message: '写回目标不存在、已被删除，或已经不属于当前项目。',
      suggestion: '请重新匹配目标；没有合适目标时，忽略该提案并重新生成。',
      retryable: false
    }
  }
  if (
    normalized.includes('database is locked') || normalized.includes('sqlite_busy') ||
    normalized.includes('database is busy')
  ) {
    return {
      errorCode: 'DATABASE_BUSY',
      message: '工作区数据库正被其他保存操作占用。',
      suggestion: '请稍候片刻，然后重试这条变更。',
      retryable: true
    }
  }
  if (
    error.includes('缺少') || error.includes('不合法') || error.includes('非法') ||
    error.includes('不支持') || error.includes('无法删除最后') || error.includes('至少需要保留')
  ) {
    return {
      errorCode: 'INVALID_CHANGE',
      message: error,
      suggestion: '这条提案不能直接写回，请检查内容后忽略并重新生成。',
      retryable: false
    }
  }
  return {
    errorCode: 'UNKNOWN',
    message: error || '写回时发生未知错误。',
    suggestion: '请先重试；如果仍然失败，请保留该提案并查看应用日志。',
    retryable: true
  }
}

export function enrichCommitResult(result: StagedChangeCommitResult): StagedChangeCommitResult {
  if (result.ok || result.errorCode) return result
  return {
    ...result,
    ...failureDetails(result.error ?? '')
  }
}

export async function finalizeCommitBatch(
  results: StagedChangeCommitResult[],
  refreshSnapshot?: () => Promise<void> | void
): Promise<StagedChangeCommitResult[]> {
  const enriched = results.map(enrichCommitResult)
  if (!refreshSnapshot || !enriched.some((result) => result.ok)) return enriched

  try {
    await refreshSnapshot()
    return enriched
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[assistant-v2] workspace refresh after commit failed:', error)
    return enriched.map((result) => result.ok
      ? {
          ...result,
          warning: `变更已经写入，但界面刷新失败（${detail}）。请重新打开项目查看最新内容。`
        }
      : result)
  }
}
