import type { SurfaceDefinition } from '@shared/assistant-runtime'
import type { AssistantPlanIntent } from './planner'

export interface NamedToolLike {
  definition: { name: string }
}

const COMMON_TOOLS = new Set([
  'read_chapter', 'read_project_data', 'search_project', 'list_chapters', 'list_outline_volumes',
  'skill_list', 'skill_load', 'skill_read_reference', 'skill_glob', 'skill_run_script'
])

const CHAPTER_STAGE_TOOLS = new Set([
  'stage_chapter_edit', 'stage_chapter_create', 'stage_chapter_update', 'stage_chapter_delete',
  'stage_chapter_restore', 'list_chapter_versions'
])

const MUTATION_PATTERN = /(修改|调整|新增|新建|创建|删除|移除|改|重写|补充|录入|更新|替换|润色|续写|扩写)/

function targetStageTools(text: string): Set<string> {
  const names = new Set<string>()
  if (/(世界观|设定|规则|体系|能力|境界)/.test(text)) {
    names.add('stage_worldview')
    names.add('stage_constraint')
  }
  if (/(人物|角色|人设|主角|配角)/.test(text)) {
    names.add('stage_character')
    names.add('stage_relationship')
    names.add('stage_organization_membership')
  }
  if (/(关系)/.test(text)) names.add('stage_relationship')
  if (/(组织|势力|学院|宗门|家族|成员|归属)/.test(text)) {
    names.add('stage_organization')
    names.add('stage_organization_membership')
  }
  if (/(大纲|剧情节点|卷纲|分卷)/.test(text)) {
    names.add('stage_outline')
    names.add('stage_outline_volume')
  }
  if (/(章节|正文|初稿|续写|扩写|润色|改写)/.test(text)) {
    for (const name of CHAPTER_STAGE_TOOLS) names.add(name)
  }
  if (/(线索|伏笔|悬念)/.test(text)) names.add('stage_plot_thread')
  if (/(灵感)/.test(text)) names.add('stage_inspiration')
  if (/(知识库|资料库|知识文档)/.test(text)) names.add('stage_knowledge_document')
  if (/(计划|进度|当前状态|创作记忆)/.test(text)) names.add('stage_workflow_document')
  if (/(书名|题材|平台|项目资料|项目名称)/.test(text)) names.add('stage_project_metadata')
  return names
}

/**
 * 在 Surface 权限之上进一步按本轮意图裁剪工具目录。
 * 只影响模型看到的目录，不放宽任何权限；无法判断目标的录入/修正任务保守保留全部。
 */
export function selectToolsForTurn<T extends NamedToolLike>(
  tools: readonly T[],
  params: { surface: SurfaceDefinition; intent: AssistantPlanIntent; userMessage: string }
): T[] {
  if (params.surface.scope === 'chapter' || params.surface.scope === 'selection') return [...tools]

  const text = params.userMessage.replace(/\s+/g, '')
  const targetTools = targetStageTools(text)
  const allowAllStages = params.intent === 'ingest'
    || (targetTools.size === 0 && (
      params.intent === 'correct'
      || params.intent === 'entity-edit'
      || MUTATION_PATTERN.test(text)
    ))
  const auditTools = new Set(['knowledge_save_document', 'stage_knowledge_document'])

  return tools.filter((tool) => {
    const name = tool.definition.name
    if (COMMON_TOOLS.has(name)) return true
    if (allowAllStages && (name.startsWith('stage_') || name === 'knowledge_save_document')) return true
    if (targetTools.has(name)) return true
    if (params.intent === 'audit' && auditTools.has(name)) return true
    return false
  })
}
