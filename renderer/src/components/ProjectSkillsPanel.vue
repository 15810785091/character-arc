<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { BookOpenText, ChevronDown, Trash2 } from 'lucide-vue-next'
import { NButton, NCheckbox, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { normalizeSkillUsePolicy, type SkillUseMode } from '@shared/assistant-runtime'
import { novelWorkflowStageDefinitions } from '@/features/novelWorkflow/stages'
import { useAppStore } from '@/stores/app'
import type { NovelWorkflowStageId, ProjectSkillItem } from '@/types/app'

const props = withDefaults(defineProps<{
  scope?: 'global' | 'project'
}>(), {
  scope: 'global'
})

const appStore = useAppStore()
const message = useMessage()
const dialog = useDialog()

const isScanningProjectSkills = ref(false)
const isImportingProjectSkills = ref(false)
const projectSkillItems = ref<ProjectSkillItem[]>([])

const currentProject = computed(() => appStore.currentProject)
const isProjectScope = computed(() => props.scope === 'project')
const scanTargetId = computed(() => isProjectScope.value ? (currentProject.value?.id ?? '') : '')
const workflowStages = computed(() => novelWorkflowStageDefinitions)
const resolvedProjectSkills = computed(() => {
  if (!isProjectScope.value) {
    return projectSkillItems.value.map((skill) => ({
      ...skill,
      enabled: skill.compatibility === 'external-only' ? false : skill.enabled
    }))
  }
  const stateMap = new Map((currentProject.value?.projectSkills ?? []).map((skill) => [skill.id, skill]))
  return projectSkillItems.value.map((skill) => ({
    ...skill,
    enabled: skill.compatibility === 'external-only'
      ? false
      : (stateMap.get(skill.id)?.enabled ?? skill.enabled),
    stageIds: stateMap.get(skill.id)?.stageIds ?? skill.stageIds
  }))
})
const nativeProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.compatibility === 'native').length
)
const enabledProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.enabled).length
)
const externalProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.compatibility === 'external-only').length
)
const builtinProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.scope === 'builtin').length
)
const importedProjectSkillCount = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.scope !== 'builtin').length
)
const projectSkillPolicy = computed(() => normalizeSkillUsePolicy(currentProject.value?.skillPolicy))
const selectableDefaultSkills = computed(() =>
  resolvedProjectSkills.value.filter((skill) => skill.enabled && skill.compatibility !== 'external-only')
)
const skillPolicyModeOptions: Array<{ label: string; value: SkillUseMode }> = [
  { label: '自动匹配', value: 'auto' },
  { label: '仅使用指定 Skill', value: 'only' },
  { label: '不使用 Skill', value: 'off' }
]

const groupedSkills = computed(() => {
  const groups: Array<{ name: string; label: string; skills: typeof resolvedProjectSkills.value }> = []
  const groupMap = new Map<string, typeof resolvedProjectSkills.value>()

  for (const skill of resolvedProjectSkills.value) {
    const segments = skill.path.split('/')
    const groupName = skill.scope === 'builtin'
      ? '_builtin'
      : (segments.length > 2 ? segments[1] : '_imported')
    if (!groupMap.has(groupName)) groupMap.set(groupName, [])
    groupMap.get(groupName)!.push(skill)
  }

  const groupLabels: Record<string, string> = {
    '_builtin': '内置 Skills',
    '_imported': isProjectScope.value ? '全局与项目扩展' : '用户导入 Skills'
  }

  for (const [name, skills] of groupMap) {
    groups.push({
      name,
      label: groupLabels[name] ?? name,
      skills
    })
  }

  return groups
})

const collapsedGroups = reactive<Record<string, boolean>>({})

function toggleGroup(groupName: string): void {
  collapsedGroups[groupName] = !collapsedGroups[groupName]
}

watch(
  () => [props.scope, scanTargetId.value],
  () => {
    void scanProjectSkills()
  },
  { immediate: true }
)

function resolveSkillCategoryLabel(category?: ProjectSkillItem['category']): string {
  switch (category) {
    case 'market':
      return '扫榜'
    case 'analysis':
      return '拆文'
    case 'polish':
      return '润色'
    case 'cover':
      return '封面'
    case 'tool':
      return '工具'
    case 'writing':
    default:
      return '写作'
  }
}

function resolveSkillCompatibilityLabel(compatibility?: ProjectSkillItem['compatibility']): string {
  switch (compatibility) {
    case 'native':
      return '已适配'
    case 'external-only':
      return '外部能力'
    case 'partial':
    default:
      return '部分适配'
  }
}

async function scanProjectSkills(): Promise<void> {
  if (isScanningProjectSkills.value) {
    return
  }

  isScanningProjectSkills.value = true
  try {
    const result = await window.characterArc.scanProjectSkills(scanTargetId.value)
    if (!result.success) {
      throw new Error(result.error ?? 'Skill 扫描失败')
    }

    const scannedSkills = result.skills ?? []
    projectSkillItems.value = scannedSkills
    if (isProjectScope.value && currentProject.value?.id) {
      const previousSkills = currentProject.value.projectSkills ?? []
      const findPreviousSkill = (skill: ProjectSkillItem): ProjectSkillItem | undefined => {
        const exact = previousSkills.find((item) => item.id === skill.id)
        if (exact) return exact
        const description = skill.description.trim()
        if (!description) return undefined
        const matches = previousSkills.filter((item) => item.description.trim() === description)
        return matches.length > 0 ? (matches.find((item) => item.enabled) ?? matches[0]) : undefined
      }
      const canonicalIdByLegacyId = new Map<string, string>()
      for (const previous of previousSkills) {
        const canonical = scannedSkills.find((skill) => skill.id === previous.id)
          ?? scannedSkills.find((skill) => (
            previous.description.trim()
            && skill.description.trim() === previous.description.trim()
          ))
        if (canonical) canonicalIdByLegacyId.set(previous.id, canonical.id)
      }
      const nextPolicyIds = projectSkillPolicy.value.skillIds
        .map((id) => canonicalIdByLegacyId.get(id) ?? id)
        .filter((id, index, all) => scannedSkills.some((skill) => skill.id === id) && all.indexOf(id) === index)

      appStore.updateProject(currentProject.value.id, {
        projectSkills: scannedSkills.map((skill) => {
          const previous = findPreviousSkill(skill)
          return {
          ...skill,
          enabled: skill.compatibility === 'external-only'
            ? false
            : (previous?.enabled ?? skill.enabled),
          stageIds: previous?.stageIds ?? skill.stageIds
          }
        }),
        skillPolicy: {
          ...projectSkillPolicy.value,
          skillIds: nextPolicyIds
        }
      })
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'Skill 扫描失败')
  } finally {
    isScanningProjectSkills.value = false
  }
}

async function importProjectSkillsPackage(): Promise<void> {
  if (isImportingProjectSkills.value) {
    return
  }

  isImportingProjectSkills.value = true
  try {
    const result = await window.characterArc.importProjectSkillsPackage(scanTargetId.value)
    if (result.canceled) {
      return
    }

    if (!result.success) {
      throw new Error(result.error ?? 'Skill 导入失败')
    }

    await scanProjectSkills()
    message.success(`已导入 ${result.importedSkillIds?.length ?? 0} 个 Skill`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'Skill 导入失败')
  } finally {
    isImportingProjectSkills.value = false
  }
}

function toggleProjectSkill(skillId: string): void {
  if (!isProjectScope.value || !currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) =>
    skill.id === skillId
      ? {
          ...skill,
          enabled: skill.compatibility === 'external-only' ? false : !skill.enabled
        }
      : skill
  )

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills,
    skillPolicy: {
      ...projectSkillPolicy.value,
      skillIds: projectSkillPolicy.value.skillIds.filter((id) => nextSkills.some((skill) => skill.id === id && skill.enabled))
    }
  })
}

function updateSkillPolicyMode(mode: SkillUseMode): void {
  if (!isProjectScope.value || !currentProject.value?.id) return
  appStore.updateProject(currentProject.value.id, {
    skillPolicy: { ...projectSkillPolicy.value, mode }
  })
}

function toggleDefaultPolicySkill(skillId: string): void {
  if (!isProjectScope.value || !currentProject.value?.id) return
  const selected = projectSkillPolicy.value.skillIds
  appStore.updateProject(currentProject.value.id, {
    skillPolicy: {
      mode: 'only',
      skillIds: selected.includes(skillId)
        ? selected.filter((id) => id !== skillId)
        : [...selected, skillId]
    }
  })
}

function toggleProjectSkillStage(skillId: string, stageId: NovelWorkflowStageId): void {
  if (!isProjectScope.value || !currentProject.value?.id) {
    return
  }

  const nextSkills = resolvedProjectSkills.value.map((skill) => {
    if (skill.id !== skillId) {
      return skill
    }

    if (skill.compatibility === 'external-only') {
      return skill
    }

    const nextStageIds = skill.stageIds.includes(stageId)
      ? skill.stageIds.filter((id) => id !== stageId)
      : [...skill.stageIds, stageId]

    return {
      ...skill,
      stageIds: nextStageIds
    }
  })

  appStore.updateProject(currentProject.value.id, {
    projectSkills: nextSkills
  })
}

async function deleteGlobalSkill(skill: ProjectSkillItem): Promise<void> {
  if (isProjectScope.value || skill.scope === 'builtin') return
  const result = await window.characterArc.deleteGlobalSkill(skill.id)
  if (!result.success) {
    message.error(result.error ?? '删除全局 Skill 失败')
    return
  }
  await scanProjectSkills()
  message.success(`已删除全局 Skill：${skill.name}`)
}

function requestDeleteGlobalSkill(skill: ProjectSkillItem): void {
  if (isProjectScope.value || skill.scope === 'builtin') return
  dialog.warning({
    title: '删除全局 Skill',
    content: `确定删除“${skill.name}”吗？所有项目之后都无法再使用它，需要时可重新导入。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => deleteGlobalSkill(skill)
  })
}
</script>

<template>
  <section class="skills-shell">
    <section class="skills-panel">
      <div class="skills-panel-head">
        <div>
          <span class="skills-kicker">Skills</span>
          <h2>{{ isProjectScope ? '当前项目 Skill 设置' : '全局 Skill 设置' }}</h2>
          <p v-if="isProjectScope">设置当前项目允许使用的 Skill、适用阶段和 AI 对话默认策略；这些设置不会影响其他项目。</p>
          <p v-else>管理整款软件可用的 Skill。这里导入的 Skill 会对所有项目可见；项目是否启用及如何调用，请在项目设置中配置。</p>
        </div>
        <div class="skills-panel-actions">
          <n-button v-if="!isProjectScope" round strong :disabled="isImportingProjectSkills" @click="importProjectSkillsPackage">
            {{ isImportingProjectSkills ? '导入中...' : '导入 Skill 包' }}
          </n-button>
          <n-button round strong secondary :disabled="isScanningProjectSkills" @click="scanProjectSkills">
            {{ isScanningProjectSkills ? '扫描中...' : '重新扫描' }}
          </n-button>
        </div>
      </div>

      <div v-if="resolvedProjectSkills.length > 0" class="project-skill-overview">
        <div class="project-skill-overview-card">
          <span>已识别 Skill</span>
          <strong>{{ resolvedProjectSkills.length }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>内置</span>
          <strong>{{ builtinProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>导入</span>
          <strong>{{ importedProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>{{ isProjectScope ? '项目已启用' : '默认可用' }}</span>
          <strong>{{ enabledProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>原生适配</span>
          <strong>{{ nativeProjectSkillCount }}</strong>
        </div>
        <div class="project-skill-overview-card">
          <span>外部能力</span>
          <strong>{{ externalProjectSkillCount }}</strong>
        </div>
      </div>

      <section v-if="isProjectScope && resolvedProjectSkills.length > 0" class="skill-policy-card">
        <div class="skill-policy-copy">
          <strong>AI 对话默认规则</strong>
          <p>全局助手和章节助手会默认继承这里的设置；你仍可在每个对话框里临时覆盖。</p>
        </div>
        <div class="skill-policy-controls">
          <n-select
            class="skill-policy-select"
            :value="projectSkillPolicy.mode"
            :options="skillPolicyModeOptions"
            @update:value="updateSkillPolicyMode"
          />
          <div v-if="projectSkillPolicy.mode === 'only'" class="skill-policy-picker">
            <span v-if="selectableDefaultSkills.length === 0" class="skill-policy-empty">请先启用至少一个可用 Skill。</span>
            <template v-else>
              <n-checkbox
                v-for="skill in selectableDefaultSkills"
                :key="`default-${skill.id}`"
                :checked="projectSkillPolicy.skillIds.includes(skill.id)"
                @update:checked="toggleDefaultPolicySkill(skill.id)"
              >{{ skill.name }}</n-checkbox>
            </template>
          </div>
          <small v-if="projectSkillPolicy.mode === 'only' && projectSkillPolicy.skillIds.length === 0" class="skill-policy-warning">
            当前没有选择 Skill，对话发送前需要先选择至少一个。
          </small>
        </div>
      </section>

      <div v-if="resolvedProjectSkills.length > 0" class="project-skill-groups">
        <div v-for="group in groupedSkills" :key="group.name" class="skill-group">
          <button class="skill-group-header" @click="toggleGroup(group.name)">
            <ChevronDown :size="16" class="skill-group-chevron" :class="{ collapsed: collapsedGroups[group.name] }" />
            <strong>{{ group.label }}</strong>
            <span class="skill-group-count">{{ group.skills.length }} 个</span>
            <span class="skill-group-enabled">{{ group.skills.filter(s => s.enabled).length }} {{ isProjectScope ? '已启用' : '可用' }}</span>
          </button>
          <div v-if="!collapsedGroups[group.name]" class="project-skill-list">
            <article v-for="skill in group.skills" :key="skill.id" class="project-skill-card">
              <div class="project-skill-head">
                <div>
                  <div class="project-skill-title-row">
                    <strong>{{ skill.name }}</strong>
                    <n-tag size="small" round :bordered="false">{{ resolveSkillCategoryLabel(skill.category) }}</n-tag>
                    <n-tag
                      size="small"
                      round
                      :bordered="false"
                      :type="skill.compatibility === 'native' ? 'success' : (skill.compatibility === 'external-only' ? 'warning' : 'default')"
                    >
                      {{ resolveSkillCompatibilityLabel(skill.compatibility) }}
                    </n-tag>
                  </div>
                  <p class="project-skill-description">{{ skill.description || '当前 skill 未提供描述。' }}</p>
                </div>
                <div class="project-skill-actions">
                  <n-button
                    v-if="isProjectScope"
                    size="small"
                    :type="skill.enabled ? 'primary' : 'default'"
                    :secondary="!skill.enabled"
                    :disabled="skill.compatibility === 'external-only'"
                    @click="toggleProjectSkill(skill.id)"
                  >{{ skill.compatibility === 'external-only' ? '暂不接入' : (skill.enabled ? '已启用' : '已停用') }}</n-button>
                  <n-tag v-else size="small" round :bordered="false" :type="skill.compatibility === 'external-only' ? 'warning' : 'success'">
                    {{ skill.compatibility === 'external-only' ? '暂不接入' : '全局可用' }}
                  </n-tag>
                  <n-button
                    v-if="!isProjectScope && skill.scope !== 'builtin'"
                    size="small"
                    type="error"
                    secondary
                    @click="requestDeleteGlobalSkill(skill)"
                  >
                    <template #icon><Trash2 :size="14" /></template>
                    删除
                  </n-button>
                </div>
              </div>
              <div class="project-skill-meta-row">
                <span v-if="skill.source">来源：{{ skill.source }}</span>
                <span v-if="skill.referencesCount">资料：{{ skill.referencesCount }} 份</span>
                <span v-if="skill.version">v{{ skill.version }}</span>
              </div>
              <div v-if="isProjectScope" class="project-skill-stage-row">
                <span class="project-skill-stage-label">适用阶段</span>
                <div class="project-skill-stage-chips">
                  <n-button
                    v-for="stage in workflowStages"
                    :key="`${skill.id}-${stage.id}`"
                    size="tiny"
                    :type="skill.stageIds.includes(stage.id) ? 'primary' : 'default'"
                    :secondary="!skill.stageIds.includes(stage.id)"
                    :disabled="skill.compatibility === 'external-only'"
                    @click="toggleProjectSkillStage(skill.id, stage.id)"
                  >{{ stage.title }}</n-button>
                </div>
              </div>
              <div v-else class="project-skill-stage-row">
                <span class="project-skill-stage-label">默认适用阶段</span>
                <div class="project-skill-stage-chips">
                  <n-tag
                    v-for="stage in workflowStages.filter(item => skill.stageIds.includes(item.id))"
                    :key="`${skill.id}-global-${stage.id}`"
                    size="small"
                    round
                    :bordered="false"
                  >{{ stage.title }}</n-tag>
                  <span v-if="skill.stageIds.length === 0" class="skill-policy-empty">未限定阶段</span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
      <div v-else class="skills-empty-state">
        <BookOpenText :size="18" />
        <strong>{{ isProjectScope ? '当前项目还没有可用 Skill' : '还没有识别到全局 Skill' }}</strong>
        <p v-if="isProjectScope">先到全局 Skill 设置导入 Skill，再回到这里配置当前项目的启用范围和默认规则。</p>
        <p v-else>你可以导入包含 `SKILL.md` 的单个 Skill 目录，或包含多个 Skill 目录的技能包。</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.skills-shell {
  width: 100%;
}

.skills-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  padding: clamp(16px, 2vw, 22px);
}

.skills-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.skills-panel-head h2 {
  margin: 4px 0 8px;
  color: var(--arc-text-primary);
  font-size: clamp(22px, 2.2vw, 26px);
  letter-spacing: -0.04em;
}

.skills-panel-head p {
  max-width: 56rem;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.skills-kicker {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.skills-panel-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.skill-policy-card {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.3fr);
  gap: 20px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-primary-soft) 54%, var(--arc-bg-surface));
}

.skill-policy-copy strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.skill-policy-copy p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.skill-policy-controls,
.skill-policy-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-policy-select {
  width: 220px;
}

.skill-policy-picker {
  max-height: 180px;
  padding: 10px 12px;
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: 9px;
  background: var(--arc-bg-surface);
}

.skill-policy-empty,
.skill-policy-warning {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.skill-policy-warning {
  color: var(--arc-danger, #d03050);
}

@media (max-width: 760px) {
  .skill-policy-card {
    grid-template-columns: 1fr;
  }
  .skill-policy-select {
    width: 100%;
  }
}

.project-skill-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skill-group {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  overflow: hidden;
}

.skill-group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 18px;
  border: none;
  background: var(--arc-bg-body);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}

.skill-group-header:hover {
  background: var(--arc-bg-surface-hover);
}

.skill-group-header strong {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 680;
}

.skill-group-count {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.skill-group-enabled {
  margin-left: auto;
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
}

.skill-group-chevron {
  color: var(--arc-text-hint);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.skill-group-chevron.collapsed {
  transform: rotate(-90deg);
}

.project-skill-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 18px 14px;
}

.project-skill-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.project-skill-overview-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  padding: 14px 16px;
}

.project-skill-overview-card span {
  display: block;
  color: var(--arc-text-hint);
  font-size: 11px;
  margin-bottom: 6px;
}

.project-skill-overview-card strong {
  color: var(--arc-text-primary);
  font-size: 20px;
  letter-spacing: -0.03em;
}

.project-skill-card {
  border-bottom: 1px solid var(--arc-bg-surface-hover);
  background: var(--arc-bg-surface);
  padding: 14px 0;
}

.project-skill-card:last-child {
  border-bottom: none;
}

.project-skill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.project-skill-head strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.project-skill-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.project-skill-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.project-skill-head p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.project-skill-description {
  margin: 4px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-skill-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  color: var(--arc-text-hint);
  font-size: 11px;
}

.project-skill-stage-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.project-skill-stage-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
}

.project-skill-stage-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.skills-empty-state {
  display: flex;
  min-height: 140px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  text-align: center;
  padding: 20px;
}

.skills-empty-state strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.skills-empty-state p {
  max-width: 32rem;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 980px) {
  .skills-panel-head,
  .project-skill-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .skills-panel-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .project-skill-overview {
    grid-template-columns: 1fr;
  }
}
</style>
