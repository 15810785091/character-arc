import type { ContextBuildRequest, ContextSlice } from '@shared/assistant-runtime'
import { buildProjectDigest } from '../context-memory'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

export function makeProjectDigestProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'project-digest',
    priority: 90,
    truncationHint: '项目小结因预算受限省略。请调用 read_project_data 或 search_project 定位源资料。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const snapshot = accessor.getSnapshot()
      const view = getProjectView(snapshot, request.projectId)
      if (!snapshot || !view) return null
      const body = buildProjectDigest({
        project: view.project,
        workspace: view.workspace,
        knowledgeDocuments: snapshot.knowledgeDocuments,
        scopeRef: request.scopeRef
      })
      return makeSlice('project-digest', 90, 'AI 项目小结（自动派生）', body)
    }
  }
}
