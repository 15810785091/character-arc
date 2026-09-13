import { DatabaseSync } from 'node:sqlite'

// ==================== Types ====================

export interface CharacterState {
  characterId: string
  chapterIndex: number
  location: string
  physicalState: string
  mentalState: string
  arcStage: string
  powerLevel: string
  knowledge: string[]
  inventory: string[]
  goals: string[]
}

export interface Foreshadowing {
  foreshadowingId: string
  type: string
  description: string
  status: 'active' | 'advanced' | 'resolved' | 'abandoned'
  plantedChapter: number
  plantedMethod: string
  payoffChapter: number | null
  resolvedChapter: number | null
  clues: Array<{ chapter: number; clue: string; method?: string }>
  connections: string[]
  statusManagedBy: 'auto' | 'manual'
}

export type RelationshipLifecycleStatus = 'active' | 'dormant' | 'archived'

export interface RelationshipHistoryEntry {
  id: string
  chapterIndex: number | null
  fromStatus: string
  toStatus: string
  pivotEvent: string
  tensionsAdded: string[]
  tensionsResolved: string[]
  lifecycleFrom: RelationshipLifecycleStatus | ''
  lifecycleTo: RelationshipLifecycleStatus | ''
  source: 'ai' | 'automatic' | 'manual'
  createdAt: string
}

export interface Relationship {
  relationshipId: string
  participantA: string
  participantB: string
  currentStatus: string
  tensionPoints: string[]
  trajectory: string
  lastInteractionChapter: number | null
  lifecycleStatus: RelationshipLifecycleStatus
  lifecycleManagedBy: 'auto' | 'manual'
  history: RelationshipHistoryEntry[]
}

export interface TimelineEntry {
  chapterIndex: number
  storyDate: string
  events: string[]
  worldStateChanges: string[]
}

export interface WorldRule {
  ruleId: string
  ruleContent: string
  establishedChapter: number
  exceptions: string[]
  mustComply: boolean
}

export interface CountdownClock {
  clockId: string
  eventDescription: string
  deadlineChapter: number | null
  status: 'active' | 'expired' | 'resolved'
  urgency: string
}

export type EntityCandidateKind = 'character' | 'organization'
export type EntityCandidateStatus = 'observing' | 'pending' | 'confirmed' | 'ignored'

export interface EntityCandidateEvidence {
  chapterIndex: number
  quote: string
}

/**
 * 正文中发现、但尚未进入正式人物/势力库的项目级候选资料。
 * observing 用于跨章节累计证据，pending 才会打扰用户审阅。
 */
export interface EntityCandidate {
  id: string
  kind: EntityCandidateKind
  name: string
  aliases: string[]
  roleOrType: string
  description: string
  status: EntityCandidateStatus
  confidence: number
  chapterCount: number
  evidence: EntityCandidateEvidence[]
  hasDialogue: boolean
  plotImpact: boolean
  explicitImportance: boolean
  linkedEntityId: string
  createdAt: string
  updatedAt: string
}

export interface StateDelta {
  entity_candidates?: Array<{
    kind: EntityCandidateKind
    name: string
    aliases?: string[]
    role_or_type?: string
    description?: string
    source_quote: string
    has_dialogue?: boolean
    plot_impact?: boolean
    explicit_importance?: boolean
  }>
  characters_updated: Array<{
    character_id: string
    changes: {
      location?: { from: string; to: string }
      physical_state?: string
      mental_state?: string
      arc_progression?: string
      power_level?: string
      inventory_delta?: { added: string[]; removed: string[] }
      new_knowledge?: string[]
      goals_update?: { completed: string[]; added: string[] }
    }
  }>
  relationships_delta: Array<{
    relationship_id: string
    participants?: [string, string]
    status_change?: { from: string; to: string; pivot_event: string }
    new_tension_points?: string[]
    resolved_tension_points?: string[]
    lifecycle?: 'active' | 'dormant' | 'archived'
  }>
  foreshadowing_delta: {
    planted: Array<{ id: string; type: string; description: string; method: string; payoff_chapter?: number }>
    advanced: Array<{ id: string; clue: string; method: string }>
    resolved: Array<{ id: string; method: string; impact: string }>
    abandoned: Array<{ id: string; reason: string }>
  }
  timeline: {
    story_time_elapsed: string
    current_story_date: string
    events: string[]
    world_state_changes?: string[]
  }
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function asItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value != null && typeof value === 'object' ? [value] : []
}

function asString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : ''
}

function asOptionalNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(asString(value))
  return Number.isFinite(number) ? number : undefined
}

function uniqueStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : []
  return [...new Set(values.map(asString).filter(Boolean))]
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeCandidateName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·・•._—–-]+/g, '')
    .replace(/[“”‘’'"《》〈〉【】\[\]()（）]/g, '')
}

const GENERIC_ENTITY_NAMES = new Set([
  '路人', '路人甲', '路人乙', '守卫', '侍卫', '卫兵', '士兵', '弟子', '师兄', '师姐',
  '师弟', '师妹', '老人', '老者', '男人', '女人', '少年', '少女', '孩子', '店小二',
  '掌柜', '黑衣人', '蒙面人', '陌生人', '众人', '村民', '学生', '老师', '医生', '护士'
])

export function isEligibleCandidateName(value: string): boolean {
  const name = value.trim()
  if (name.length < 2 || name.length > 32) return false
  const normalized = normalizeCandidateName(name)
  if (!normalized || GENERIC_ENTITY_NAMES.has(normalized)) return false
  if (/^(一名|一个|那个|这位|某个|几名|两名)/.test(name)) return false
  if (/^(第[一二三四五六七八九十百]+|[甲乙丙丁戊己庚辛壬癸])号$/.test(name)) return false
  return true
}

/** 将不可信的模型输出收敛为可安全遍历、可写入 SQLite 的状态增量。 */
export function normalizeStateDelta(value: unknown): StateDelta {
  const root = asRecord(value)

  const charactersUpdated = asItems(root.characters_updated).flatMap((item) => {
    const record = asRecord(item)
    const characterId = asString(record.character_id)
    if (!characterId) return []
    const rawChanges = asRecord(record.changes)
    const changes: StateDelta['characters_updated'][number]['changes'] = {}
    const rawLocation = asRecord(rawChanges.location)
    const locationTo = asString(rawLocation.to)
    if (locationTo) {
      changes.location = { from: asString(rawLocation.from), to: locationTo }
    }

    const scalarFields = [
      ['physical_state', 'physical_state'],
      ['mental_state', 'mental_state'],
      ['arc_progression', 'arc_progression'],
      ['power_level', 'power_level']
    ] as const
    for (const [sourceKey, targetKey] of scalarFields) {
      const normalized = asString(rawChanges[sourceKey])
      if (normalized) changes[targetKey] = normalized
    }

    const rawInventory = asRecord(rawChanges.inventory_delta)
    const inventoryAdded = uniqueStrings(rawInventory.added)
    const inventoryRemoved = uniqueStrings(rawInventory.removed)
    if (inventoryAdded.length || inventoryRemoved.length) {
      changes.inventory_delta = { added: inventoryAdded, removed: inventoryRemoved }
    }

    const newKnowledge = uniqueStrings(rawChanges.new_knowledge)
    if (newKnowledge.length) changes.new_knowledge = newKnowledge

    const rawGoals = asRecord(rawChanges.goals_update)
    const goalsCompleted = uniqueStrings(rawGoals.completed)
    const goalsAdded = uniqueStrings(rawGoals.added)
    if (goalsCompleted.length || goalsAdded.length) {
      changes.goals_update = { completed: goalsCompleted, added: goalsAdded }
    }

    return Object.keys(changes).length ? [{ character_id: characterId, changes }] : []
  })

  const relationshipsDelta = asItems(root.relationships_delta).flatMap((item) => {
    const record = asRecord(item)
    const relationshipId = asString(record.relationship_id)
    if (!relationshipId) return []
    const rawParticipants = Array.isArray(record.participants) ? record.participants.map(asString).filter(Boolean) : []
    const rawStatus = asRecord(record.status_change)
    const statusTo = asString(rawStatus.to)
    const normalized = {
      relationship_id: relationshipId,
      participants: rawParticipants.length >= 2
        ? [rawParticipants[0], rawParticipants[1]] as [string, string]
        : undefined,
      status_change: statusTo
        ? { from: asString(rawStatus.from), to: statusTo, pivot_event: asString(rawStatus.pivot_event) }
        : undefined,
      new_tension_points: uniqueStrings(record.new_tension_points),
      resolved_tension_points: uniqueStrings(record.resolved_tension_points),
      lifecycle: ['active', 'dormant', 'archived'].includes(asString(record.lifecycle))
        ? asString(record.lifecycle) as RelationshipLifecycleStatus
        : undefined
    }
    return normalized.participants || normalized.status_change || normalized.new_tension_points.length
      || normalized.resolved_tension_points.length || normalized.lifecycle
      ? [normalized]
      : []
  })

  const rawForeshadowing = asRecord(root.foreshadowing_delta)
  const planted = asItems(rawForeshadowing.planted).flatMap((item) => {
    const record = asRecord(item)
    const id = asString(record.id)
    if (!id) return []
    const description = asString(record.description)
    if (!description) return []
    return [{
      id,
      type: asString(record.type) || '暗线',
      description,
      method: asString(record.method),
      payoff_chapter: asOptionalNumber(record.payoff_chapter)
    }]
  })
  const advanced = asItems(rawForeshadowing.advanced).flatMap((item) => {
    const record = asRecord(item)
    const id = asString(record.id)
    return id ? [{ id, clue: asString(record.clue), method: asString(record.method) }] : []
  })
  const resolved = asItems(rawForeshadowing.resolved).flatMap((item) => {
    const record = asRecord(item)
    const id = asString(record.id)
    return id ? [{ id, method: asString(record.method), impact: asString(record.impact) }] : []
  })
  const abandoned = asItems(rawForeshadowing.abandoned).flatMap((item) => {
    const record = asRecord(item)
    const id = asString(record.id)
    return id ? [{ id, reason: asString(record.reason) }] : []
  })

  const rawTimeline = asRecord(root.timeline)
  const entityCandidates = asItems(root.entity_candidates).flatMap((item) => {
    const record = asRecord(item)
    const kind = asString(record.kind)
    const name = asString(record.name)
    const sourceQuote = asString(record.source_quote)
    if ((kind !== 'character' && kind !== 'organization') || !name || !sourceQuote) return []
    return [{
      kind: kind as EntityCandidateKind,
      name,
      aliases: uniqueStrings(record.aliases),
      role_or_type: asString(record.role_or_type),
      description: asString(record.description),
      source_quote: sourceQuote,
      has_dialogue: Boolean(record.has_dialogue),
      plot_impact: Boolean(record.plot_impact),
      explicit_importance: Boolean(record.explicit_importance)
    }]
  })
  return {
    entity_candidates: uniqueBy(entityCandidates, (item) => `${item.kind}\u0000${normalizeCandidateName(item.name)}`),
    characters_updated: uniqueBy(charactersUpdated, (item) => item.character_id),
    relationships_delta: uniqueBy(relationshipsDelta, (item) => item.relationship_id),
    foreshadowing_delta: {
      planted: uniqueBy(planted, (item) => item.id),
      advanced: uniqueBy(advanced, (item) => `${item.id}\u0000${item.clue}\u0000${item.method}`),
      resolved: uniqueBy(resolved, (item) => item.id),
      abandoned: uniqueBy(abandoned, (item) => item.id)
    },
    timeline: {
      story_time_elapsed: asString(rawTimeline.story_time_elapsed),
      current_story_date: asString(rawTimeline.current_story_date),
      events: uniqueStrings(rawTimeline.events),
      world_state_changes: uniqueStrings(rawTimeline.world_state_changes)
    }
  }
}

export function hasStateDeltaContent(delta: StateDelta): boolean {
  return Boolean(delta.entity_candidates?.length)
    || delta.characters_updated.length > 0
    || delta.relationships_delta.length > 0
    || delta.foreshadowing_delta.planted.length > 0
    || delta.foreshadowing_delta.advanced.length > 0
    || delta.foreshadowing_delta.resolved.length > 0
    || delta.foreshadowing_delta.abandoned.length > 0
    || delta.timeline.events.length > 0
    || Boolean(delta.timeline.world_state_changes?.length)
    || Boolean(delta.timeline.current_story_date)
    || Boolean(delta.timeline.story_time_elapsed)
}

export interface ForeshadowingHealthReport {
  totalActive: number
  overdue: Array<{ id: string; plantedChapter: number; expectedPayoff: number }>
  densityWarning: boolean
  currentChapter: number
}

export interface StoryStateContext {
  characterStates: CharacterState[]
  activeForeshadowing: Foreshadowing[]
  relationships: Relationship[]
  recentTimeline: TimelineEntry[]
  worldRules: WorldRule[]
  activeClocks: CountdownClock[]
}

export interface StoryStateOverview extends StoryStateContext {
  allForeshadowing: Foreshadowing[]
  allRelationships: Relationship[]
  entityCandidates: EntityCandidate[]
}

export type StoryStateLifecycleAction =
  | {
      kind: 'foreshadowing-status'
      entityId: string
      status: Foreshadowing['status']
    }
  | {
      kind: 'relationship-lifecycle'
      entityId: string
      status: RelationshipLifecycleStatus | 'auto'
    }
  | {
      kind: 'relationship-resolve-tension'
      entityId: string
      tensionPoint: string
    }
  | {
      kind: 'entity-candidate-status'
      entityId: string
      status: 'observing' | 'ignored'
    }
  | {
      kind: 'entity-candidate-confirm'
      entityId: string
      linkedEntityId: string
    }

// ==================== Schema ====================

const STORY_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS story_character_state (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    physical_state TEXT NOT NULL DEFAULT '正常',
    mental_state TEXT NOT NULL DEFAULT '',
    arc_stage TEXT NOT NULL DEFAULT '',
    power_level TEXT NOT NULL DEFAULT '',
    knowledge_json TEXT NOT NULL DEFAULT '[]',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    goals_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_char_state_unique
    ON story_character_state(project_id, character_id, chapter_index);

  CREATE TABLE IF NOT EXISTS story_foreshadowing (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    foreshadowing_id TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    planted_chapter INTEGER NOT NULL,
    planted_method TEXT NOT NULL DEFAULT '',
    payoff_chapter INTEGER,
    resolved_chapter INTEGER,
    clues_json TEXT NOT NULL DEFAULT '[]',
    connections_json TEXT NOT NULL DEFAULT '[]',
    status_managed_by TEXT NOT NULL DEFAULT 'auto',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_foreshadowing_project_fid
    ON story_foreshadowing(project_id, foreshadowing_id);

  CREATE TABLE IF NOT EXISTS story_relationships (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL,
    participant_a TEXT NOT NULL,
    participant_b TEXT NOT NULL,
    current_status TEXT NOT NULL,
    tension_points_json TEXT NOT NULL DEFAULT '[]',
    trajectory TEXT NOT NULL DEFAULT '',
    last_interaction_chapter INTEGER,
    lifecycle_status TEXT NOT NULL DEFAULT 'active',
    lifecycle_managed_by TEXT NOT NULL DEFAULT 'auto',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_project_rid
    ON story_relationships(project_id, relationship_id);

  CREATE TABLE IF NOT EXISTS story_relationship_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL,
    chapter_index INTEGER,
    from_status TEXT NOT NULL DEFAULT '',
    to_status TEXT NOT NULL DEFAULT '',
    pivot_event TEXT NOT NULL DEFAULT '',
    tensions_added_json TEXT NOT NULL DEFAULT '[]',
    tensions_resolved_json TEXT NOT NULL DEFAULT '[]',
    lifecycle_from TEXT NOT NULL DEFAULT '',
    lifecycle_to TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'ai',
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_relationship_history_lookup
    ON story_relationship_history(project_id, relationship_id, chapter_index DESC);

  CREATE TABLE IF NOT EXISTS story_timeline (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    story_date TEXT NOT NULL DEFAULT '',
    events_json TEXT NOT NULL DEFAULT '[]',
    world_state_changes_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_unique
    ON story_timeline(project_id, chapter_index);

  CREATE TABLE IF NOT EXISTS story_world_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    established_chapter INTEGER NOT NULL,
    exceptions_json TEXT NOT NULL DEFAULT '[]',
    must_comply INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_rules_project_rid
    ON story_world_rules(project_id, rule_id);

  CREATE TABLE IF NOT EXISTS story_countdown_clocks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    clock_id TEXT NOT NULL,
    event_description TEXT NOT NULL,
    deadline_chapter INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    urgency TEXT NOT NULL DEFAULT 'medium',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS story_entity_candidates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    role_or_type TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'observing',
    confidence INTEGER NOT NULL DEFAULT 0,
    chapter_indexes_json TEXT NOT NULL DEFAULT '[]',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    has_dialogue INTEGER NOT NULL DEFAULT 0,
    plot_impact INTEGER NOT NULL DEFAULT 0,
    explicit_importance INTEGER NOT NULL DEFAULT 0,
    linked_entity_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_story_entity_candidates_unique
    ON story_entity_candidates(project_id, kind, normalized_name);

  CREATE INDEX IF NOT EXISTS idx_story_entity_candidates_status
    ON story_entity_candidates(project_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS story_embeddings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    chapter_index INTEGER,
    text_content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_embeddings_project
    ON story_embeddings(project_id, source_type);

  CREATE TABLE IF NOT EXISTS embedding_metadata (
    key TEXT PRIMARY KEY,
    dimension INTEGER NOT NULL
  ) STRICT;
`

// ==================== Helpers ====================

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function now(): string {
  return new Date().toISOString()
}

// ==================== Store ====================

export function initStoryStateSchema(db: DatabaseSync): void {
  db.exec(STORY_STATE_SCHEMA)
  ensureColumn(db, 'story_foreshadowing', 'status_managed_by', "TEXT NOT NULL DEFAULT 'auto'")
  ensureColumn(db, 'story_relationships', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(db, 'story_relationships', 'lifecycle_managed_by', "TEXT NOT NULL DEFAULT 'auto'")
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>
  if (columns.some((item) => String(item.name) === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function getLatestCharacterStates(
  db: DatabaseSync,
  projectId: string,
  characterIds: string[]
): CharacterState[] {
  if (!characterIds.length) return []

  const placeholders = characterIds.map(() => '?').join(',')
  const stmt = db.prepare(`
    SELECT cs.* FROM story_character_state cs
    INNER JOIN (
      SELECT character_id, MAX(chapter_index) as max_ch
      FROM story_character_state
      WHERE project_id = ? AND character_id IN (${placeholders})
      GROUP BY character_id
    ) latest ON cs.character_id = latest.character_id AND cs.chapter_index = latest.max_ch
    WHERE cs.project_id = ?
  `)

  const rows = stmt.all(projectId, ...characterIds, projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    characterId: String(row.character_id),
    chapterIndex: Number(row.chapter_index),
    location: String(row.location ?? ''),
    physicalState: String(row.physical_state ?? '正常'),
    mentalState: String(row.mental_state ?? ''),
    arcStage: String(row.arc_stage ?? ''),
    powerLevel: String(row.power_level ?? ''),
    knowledge: parseJson<string[]>(row.knowledge_json, []),
    inventory: parseJson<string[]>(row.inventory_json, []),
    goals: parseJson<string[]>(row.goals_json, [])
  }))
}

export function getAllCharacterIds(db: DatabaseSync, projectId: string): string[] {
  const stmt = db.prepare(
    `SELECT DISTINCT character_id FROM story_character_state WHERE project_id = ?`
  )
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => String(row.character_id))
}

export function getActiveForeshadowing(
  db: DatabaseSync,
  projectId: string,
  limit = 30
): Foreshadowing[] {
  const stmt = db.prepare(`
    SELECT * FROM story_foreshadowing
    WHERE project_id = ? AND status IN ('active', 'advanced')
    ORDER BY planted_chapter ASC
    LIMIT ?
  `)
  const rows = stmt.all(projectId, limit) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    foreshadowingId: String(row.foreshadowing_id),
    type: String(row.type),
    description: String(row.description),
    status: String(row.status) as Foreshadowing['status'],
    plantedChapter: Number(row.planted_chapter),
    plantedMethod: String(row.planted_method ?? ''),
    payoffChapter: row.payoff_chapter != null ? Number(row.payoff_chapter) : null,
    resolvedChapter: row.resolved_chapter != null ? Number(row.resolved_chapter) : null,
    clues: parseJson<Foreshadowing['clues']>(row.clues_json, []),
    connections: parseJson<string[]>(row.connections_json, []),
    statusManagedBy: String(row.status_managed_by ?? 'auto') === 'manual' ? 'manual' : 'auto'
  }))
}

export function getAllForeshadowing(db: DatabaseSync, projectId: string): Foreshadowing[] {
  const rows = db.prepare(`
    SELECT * FROM story_foreshadowing
    WHERE project_id = ?
    ORDER BY planted_chapter ASC, rowid ASC
  `).all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    foreshadowingId: String(row.foreshadowing_id),
    type: String(row.type),
    description: String(row.description),
    status: String(row.status) as Foreshadowing['status'],
    plantedChapter: Number(row.planted_chapter),
    plantedMethod: String(row.planted_method ?? ''),
    payoffChapter: row.payoff_chapter != null ? Number(row.payoff_chapter) : null,
    resolvedChapter: row.resolved_chapter != null ? Number(row.resolved_chapter) : null,
    clues: parseJson<Foreshadowing['clues']>(row.clues_json, []),
    connections: parseJson<string[]>(row.connections_json, []),
    statusManagedBy: String(row.status_managed_by ?? 'auto') === 'manual' ? 'manual' : 'auto'
  }))
}

function getRelationshipHistory(
  db: DatabaseSync,
  projectId: string,
  relationshipId: string
): RelationshipHistoryEntry[] {
  const rows = db.prepare(`
    SELECT * FROM story_relationship_history
    WHERE project_id = ? AND relationship_id = ?
    ORDER BY COALESCE(chapter_index, -1) DESC, created_at DESC, rowid DESC
    LIMIT 50
  `).all(projectId, relationshipId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    chapterIndex: row.chapter_index == null ? null : Number(row.chapter_index),
    fromStatus: String(row.from_status ?? ''),
    toStatus: String(row.to_status ?? ''),
    pivotEvent: String(row.pivot_event ?? ''),
    tensionsAdded: parseJson<string[]>(row.tensions_added_json, []),
    tensionsResolved: parseJson<string[]>(row.tensions_resolved_json, []),
    lifecycleFrom: String(row.lifecycle_from ?? '') as RelationshipHistoryEntry['lifecycleFrom'],
    lifecycleTo: String(row.lifecycle_to ?? '') as RelationshipHistoryEntry['lifecycleTo'],
    source: String(row.source ?? 'ai') as RelationshipHistoryEntry['source'],
    createdAt: String(row.created_at ?? '')
  }))
}

export function getRelationships(
  db: DatabaseSync,
  projectId: string,
  characterIds?: string[],
  includeInactive = false,
  includeHistory = false
): Relationship[] {
  let sql = `SELECT * FROM story_relationships WHERE project_id = ?`
  const params: (string | number | null)[] = [projectId]

  if (characterIds?.length) {
    const placeholders = characterIds.map(() => '?').join(',')
    sql += ` AND (participant_a IN (${placeholders}) OR participant_b IN (${placeholders}))`
    params.push(...characterIds, ...characterIds)
  }
  if (!includeInactive) {
    sql += ` AND lifecycle_status = 'active'`
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(...params) as Array<Record<string, unknown>>
  return rows.map((row) => {
    const relationshipId = String(row.relationship_id)
    return {
    relationshipId,
    participantA: String(row.participant_a),
    participantB: String(row.participant_b),
    currentStatus: String(row.current_status),
    tensionPoints: parseJson<string[]>(row.tension_points_json, []),
    trajectory: String(row.trajectory ?? ''),
    lastInteractionChapter: row.last_interaction_chapter != null ? Number(row.last_interaction_chapter) : null,
    lifecycleStatus: String(row.lifecycle_status ?? 'active') as RelationshipLifecycleStatus,
    lifecycleManagedBy: String(row.lifecycle_managed_by ?? 'auto') === 'manual' ? 'manual' : 'auto',
    history: includeHistory ? getRelationshipHistory(db, projectId, relationshipId) : []
  }})
}

export function getRecentTimeline(
  db: DatabaseSync,
  projectId: string,
  lastN = 5
): TimelineEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM story_timeline
    WHERE project_id = ?
    ORDER BY chapter_index DESC
    LIMIT ?
  `)
  const rows = stmt.all(projectId, lastN) as Array<Record<string, unknown>>
  return rows.reverse().map((row) => ({
    chapterIndex: Number(row.chapter_index),
    storyDate: String(row.story_date ?? ''),
    events: parseJson<string[]>(row.events_json, []),
    worldStateChanges: parseJson<string[]>(row.world_state_changes_json, [])
  }))
}

export function getWorldRules(db: DatabaseSync, projectId: string): WorldRule[] {
  const stmt = db.prepare(`SELECT * FROM story_world_rules WHERE project_id = ? ORDER BY established_chapter ASC`)
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    ruleId: String(row.rule_id),
    ruleContent: String(row.rule_content),
    establishedChapter: Number(row.established_chapter),
    exceptions: parseJson<string[]>(row.exceptions_json, []),
    mustComply: Boolean(row.must_comply)
  }))
}

export function getActiveClocks(db: DatabaseSync, projectId: string): CountdownClock[] {
  const stmt = db.prepare(`SELECT * FROM story_countdown_clocks WHERE project_id = ? AND status = 'active'`)
  const rows = stmt.all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    clockId: String(row.clock_id),
    eventDescription: String(row.event_description),
    deadlineChapter: row.deadline_chapter != null ? Number(row.deadline_chapter) : null,
    status: String(row.status) as CountdownClock['status'],
    urgency: String(row.urgency ?? 'medium')
  }))
}

export function getEntityCandidates(db: DatabaseSync, projectId: string): EntityCandidate[] {
  const rows = db.prepare(`
    SELECT * FROM story_entity_candidates
    WHERE project_id = ?
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'observing' THEN 1 WHEN 'confirmed' THEN 2 ELSE 3 END,
             updated_at DESC, rowid DESC
  `).all(projectId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as EntityCandidateKind,
    name: String(row.name),
    aliases: parseJson<string[]>(row.aliases_json, []),
    roleOrType: String(row.role_or_type ?? ''),
    description: String(row.description ?? ''),
    status: String(row.status) as EntityCandidateStatus,
    confidence: Number(row.confidence ?? 0),
    chapterCount: parseJson<number[]>(row.chapter_indexes_json, []).length,
    evidence: parseJson<EntityCandidateEvidence[]>(row.evidence_json, []),
    hasDialogue: Boolean(row.has_dialogue),
    plotImpact: Boolean(row.plot_impact),
    explicitImportance: Boolean(row.explicit_importance),
    linkedEntityId: String(row.linked_entity_id ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  }))
}

function findExistingEntityId(
  db: DatabaseSync,
  projectId: string,
  kind: EntityCandidateKind,
  names: string[]
): string {
  const normalizedNames = new Set(names.map(normalizeCandidateName).filter(Boolean))
  if (!normalizedNames.size) return ''
  const table = kind === 'character' ? 'characters' : 'organizations'
  try {
    const rows = db.prepare(`SELECT id, name FROM ${table} WHERE project_id = ?`).all(projectId) as Array<Record<string, unknown>>
    const match = rows.find((row) => normalizedNames.has(normalizeCandidateName(String(row.name ?? ''))))
    return match ? String(match.id) : ''
  } catch {
    // 独立 story-state 测试数据库不一定包含工作区业务表。
    return ''
  }
}

function upsertEntityCandidate(
  db: DatabaseSync,
  projectId: string,
  chapterIndex: number,
  candidate: NonNullable<StateDelta['entity_candidates']>[number],
  timestamp: string
): void {
  const name = candidate.name.trim()
  const aliases = [...new Set((candidate.aliases ?? []).map((item) => item.trim()).filter(Boolean))]
  if (!isEligibleCandidateName(name)) return
  // 候选名必须在模型提供的原文证据中逐字出现，避免模型凭空取名。
  if (!candidate.source_quote.includes(name)) return
  const linkedEntityId = findExistingEntityId(db, projectId, candidate.kind, [name, ...aliases])
  const normalizedName = normalizeCandidateName(name)
  const existing = db.prepare(`
    SELECT * FROM story_entity_candidates
    WHERE project_id = ? AND kind = ? AND normalized_name = ?
  `).get(projectId, candidate.kind, normalizedName) as Record<string, unknown> | undefined

  if (linkedEntityId) {
    if (existing && String(existing.status) !== 'ignored') {
      db.prepare(`
        UPDATE story_entity_candidates
        SET status = 'confirmed', linked_entity_id = ?, updated_at = ?
        WHERE id = ?
      `).run(linkedEntityId, timestamp, String(existing.id))
    }
    return
  }

  const chapterIndexes = existing
    ? parseJson<number[]>(existing.chapter_indexes_json, [])
    : []
  if (!chapterIndexes.includes(chapterIndex)) chapterIndexes.push(chapterIndex)
  chapterIndexes.sort((a, b) => a - b)

  const evidence = existing
    ? parseJson<EntityCandidateEvidence[]>(existing.evidence_json, [])
    : []
  if (!evidence.some((item) => item.chapterIndex === chapterIndex && item.quote === candidate.source_quote)) {
    evidence.push({ chapterIndex, quote: candidate.source_quote.slice(0, 280) })
  }

  const hasDialogue = Boolean(candidate.has_dialogue || existing?.has_dialogue)
  const plotImpact = Boolean(candidate.plot_impact || existing?.plot_impact)
  const explicitImportance = Boolean(candidate.explicit_importance || existing?.explicit_importance)
  const confidence = Math.min(99,
    35
    + Math.min(chapterIndexes.length, 3) * 20
    + (hasDialogue ? 6 : 0)
    + (plotImpact ? 18 : 0)
    + (explicitImportance ? 25 : 0)
  )
  const previousStatus = existing ? String(existing.status) as EntityCandidateStatus : 'observing'
  const qualifies = chapterIndexes.length >= 2 || explicitImportance || plotImpact
  const status: EntityCandidateStatus = previousStatus === 'confirmed' || previousStatus === 'ignored'
    ? previousStatus
    : qualifies ? 'pending' : 'observing'
  const mergedAliases = [...new Set([
    ...(existing ? parseJson<string[]>(existing.aliases_json, []) : []),
    ...aliases
  ])]
  const roleOrType = candidate.role_or_type?.trim() || String(existing?.role_or_type ?? '')
  const description = candidate.description?.trim() || String(existing?.description ?? '')

  if (existing) {
    db.prepare(`
      UPDATE story_entity_candidates
      SET name = ?, aliases_json = ?, role_or_type = ?, description = ?, status = ?, confidence = ?,
          chapter_indexes_json = ?, evidence_json = ?, has_dialogue = ?, plot_impact = ?,
          explicit_importance = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name, JSON.stringify(mergedAliases), roleOrType, description, status, confidence,
      JSON.stringify(chapterIndexes), JSON.stringify(evidence.slice(-12)), hasDialogue ? 1 : 0,
      plotImpact ? 1 : 0, explicitImportance ? 1 : 0, timestamp, String(existing.id)
    )
    return
  }

  db.prepare(`
    INSERT INTO story_entity_candidates (
      id, project_id, kind, normalized_name, name, aliases_json, role_or_type, description,
      status, confidence, chapter_indexes_json, evidence_json, has_dialogue, plot_impact,
      explicit_importance, linked_entity_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(
    uid(), projectId, candidate.kind, normalizedName, name, JSON.stringify(mergedAliases),
    roleOrType, description, status, confidence, JSON.stringify(chapterIndexes),
    JSON.stringify(evidence), hasDialogue ? 1 : 0, plotImpact ? 1 : 0,
    explicitImportance ? 1 : 0, timestamp, timestamp
  )
}

export function getForeshadowingHealth(
  db: DatabaseSync,
  projectId: string,
  currentChapter: number
): ForeshadowingHealthReport {
  const active = getActiveForeshadowing(db, projectId, 999)
  const overdue = active
    .filter((f) => f.payoffChapter != null && f.payoffChapter < currentChapter)
    .map((f) => ({
      id: f.foreshadowingId,
      plantedChapter: f.plantedChapter,
      expectedPayoff: f.payoffChapter!
    }))

  return {
    totalActive: active.length,
    overdue,
    densityWarning: active.length > currentChapter / 5,
    currentChapter
  }
}

// ==================== Write Operations ====================

export const RELATIONSHIP_DORMANT_AFTER_CHAPTERS = 12
export const RELATIONSHIP_ARCHIVED_AFTER_CHAPTERS = 30

function appendRelationshipHistory(
  db: DatabaseSync,
  input: {
    projectId: string
    relationshipId: string
    chapterIndex: number | null
    fromStatus?: string
    toStatus?: string
    pivotEvent?: string
    tensionsAdded?: string[]
    tensionsResolved?: string[]
    lifecycleFrom?: RelationshipLifecycleStatus | ''
    lifecycleTo?: RelationshipLifecycleStatus | ''
    source: RelationshipHistoryEntry['source']
  }
): void {
  if (input.source === 'ai' && input.chapterIndex !== null) {
    db.prepare(`
      DELETE FROM story_relationship_history
      WHERE project_id = ? AND relationship_id = ? AND chapter_index = ? AND source = 'ai'
    `).run(input.projectId, input.relationshipId, input.chapterIndex)
  }
  db.prepare(`
    INSERT INTO story_relationship_history
      (id, project_id, relationship_id, chapter_index, from_status, to_status, pivot_event,
       tensions_added_json, tensions_resolved_json, lifecycle_from, lifecycle_to, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid(), input.projectId, input.relationshipId, input.chapterIndex,
    input.fromStatus ?? '', input.toStatus ?? '', input.pivotEvent ?? '',
    JSON.stringify(input.tensionsAdded ?? []), JSON.stringify(input.tensionsResolved ?? []),
    input.lifecycleFrom ?? '', input.lifecycleTo ?? '', input.source, now()
  )
}

/**
 * 自动收敛长时间无互动的关系，避免无关关系永久占据 AI 上下文。
 * 手动指定的生命周期不会被时间规则覆盖；一旦新章节再次产生关系变更，
 * applyStateDelta 会自动唤醒该关系并恢复自动管理。
 */
export function refreshAutomaticRelationshipLifecycle(
  db: DatabaseSync,
  projectId: string,
  currentChapterIndex: number
): void {
  const rows = db.prepare(`
    SELECT relationship_id, lifecycle_status, last_interaction_chapter
    FROM story_relationships
    WHERE project_id = ? AND lifecycle_managed_by = 'auto'
  `).all(projectId) as Array<Record<string, unknown>>

  for (const row of rows) {
    const lastInteraction = row.last_interaction_chapter == null ? null : Number(row.last_interaction_chapter)
    if (lastInteraction === null || !Number.isFinite(lastInteraction)) continue
    const idleChapters = Math.max(0, currentChapterIndex - lastInteraction)
    const current = String(row.lifecycle_status ?? 'active') as RelationshipLifecycleStatus
    let next = current
    if (idleChapters >= RELATIONSHIP_ARCHIVED_AFTER_CHAPTERS) next = 'archived'
    else if (idleChapters >= RELATIONSHIP_DORMANT_AFTER_CHAPTERS && current === 'active') next = 'dormant'
    if (next === current) continue
    db.prepare(`
      UPDATE story_relationships
      SET lifecycle_status = ?, updated_at = ?
      WHERE project_id = ? AND relationship_id = ?
    `).run(next, now(), projectId, String(row.relationship_id))
    appendRelationshipHistory(db, {
      projectId,
      relationshipId: String(row.relationship_id),
      chapterIndex: currentChapterIndex,
      lifecycleFrom: current,
      lifecycleTo: next,
      source: 'automatic'
    })
  }
}

function getLatestStoryChapterIndex(db: DatabaseSync, projectId: string): number {
  const row = db.prepare(`
    SELECT MAX(chapter_index) AS chapter_index FROM (
      SELECT chapter_index FROM story_timeline WHERE project_id = ?
      UNION ALL
      SELECT chapter_index FROM story_character_state WHERE project_id = ?
      UNION ALL
      SELECT last_interaction_chapter AS chapter_index FROM story_relationships WHERE project_id = ?
    )
  `).get(projectId, projectId, projectId) as Record<string, unknown> | undefined
  const value = Number(row?.chapter_index ?? 0)
  let latest = Number.isFinite(value) ? value : 0
  try {
    const chapterRow = db.prepare(`SELECT MAX(sort_order) AS chapter_index FROM chapters WHERE project_id = ?`).get(projectId) as Record<string, unknown> | undefined
    const chapterValue = Number(chapterRow?.chapter_index ?? 0)
    if (Number.isFinite(chapterValue)) latest = Math.max(latest, chapterValue)
  } catch {
    // 独立状态库测试或旧数据库可能尚未创建 chapters 表。
  }
  return latest
}

export function updateStoryStateLifecycle(
  db: DatabaseSync,
  projectId: string,
  action: StoryStateLifecycleAction
): void {
  if (action.kind === 'foreshadowing-status' && !['active', 'advanced', 'resolved', 'abandoned'].includes(action.status)) {
    throw new Error('不支持的伏笔状态。')
  }
  if (action.kind === 'relationship-lifecycle' && !['auto', 'active', 'dormant', 'archived'].includes(action.status)) {
    throw new Error('不支持的关系生命周期。')
  }
  if (action.kind === 'relationship-resolve-tension' && !action.tensionPoint.trim()) {
    throw new Error('缺少要解决的关系张力。')
  }
  if (action.kind === 'entity-candidate-confirm' && !action.linkedEntityId.trim()) {
    throw new Error('缺少候选资料关联的正式词条。')
  }
  const timestamp = now()
  db.exec('BEGIN')
  try {
    if (action.kind === 'foreshadowing-status') {
      const row = db.prepare(`
        SELECT status FROM story_foreshadowing WHERE project_id = ? AND foreshadowing_id = ?
      `).get(projectId, action.entityId) as Record<string, unknown> | undefined
      if (!row) throw new Error('伏笔不存在。')
      const resolvedChapter = action.status === 'resolved' ? getLatestStoryChapterIndex(db, projectId) : null
      db.prepare(`
        UPDATE story_foreshadowing
        SET status = ?, resolved_chapter = ?, status_managed_by = 'manual', updated_at = ?
        WHERE project_id = ? AND foreshadowing_id = ?
      `).run(action.status, resolvedChapter, timestamp, projectId, action.entityId)
    } else if (action.kind === 'relationship-lifecycle') {
      const row = db.prepare(`
        SELECT lifecycle_status FROM story_relationships WHERE project_id = ? AND relationship_id = ?
      `).get(projectId, action.entityId) as Record<string, unknown> | undefined
      if (!row) throw new Error('角色关系不存在。')
      const previous = String(row.lifecycle_status ?? 'active') as RelationshipLifecycleStatus
      const next = action.status === 'auto' ? 'active' : action.status
      const reviewedChapter = getLatestStoryChapterIndex(db, projectId)
      db.prepare(`
        UPDATE story_relationships
        SET lifecycle_status = ?, lifecycle_managed_by = ?,
            last_interaction_chapter = CASE WHEN ? = 'auto' THEN ? ELSE last_interaction_chapter END,
            updated_at = ?
        WHERE project_id = ? AND relationship_id = ?
      `).run(next, action.status === 'auto' ? 'auto' : 'manual', action.status, reviewedChapter, timestamp, projectId, action.entityId)
      appendRelationshipHistory(db, {
        projectId,
        relationshipId: action.entityId,
        chapterIndex: reviewedChapter,
        lifecycleFrom: previous,
        lifecycleTo: next,
        source: 'manual'
      })
    } else if (action.kind === 'relationship-resolve-tension') {
      const row = db.prepare(`
        SELECT tension_points_json FROM story_relationships WHERE project_id = ? AND relationship_id = ?
      `).get(projectId, action.entityId) as Record<string, unknown> | undefined
      if (!row) throw new Error('角色关系不存在。')
      const existing = parseJson<string[]>(row.tension_points_json, [])
      const next = existing.filter((item) => item !== action.tensionPoint)
      if (next.length !== existing.length) {
        db.prepare(`
          UPDATE story_relationships SET tension_points_json = ?, updated_at = ?
          WHERE project_id = ? AND relationship_id = ?
        `).run(JSON.stringify(next), timestamp, projectId, action.entityId)
        appendRelationshipHistory(db, {
          projectId,
          relationshipId: action.entityId,
          chapterIndex: getLatestStoryChapterIndex(db, projectId),
          tensionsResolved: [action.tensionPoint],
          source: 'manual'
        })
      }
    } else if (action.kind === 'entity-candidate-status') {
      const result = db.prepare(`
        UPDATE story_entity_candidates
        SET status = ?, linked_entity_id = '', updated_at = ?
        WHERE project_id = ? AND id = ?
      `).run(action.status, timestamp, projectId, action.entityId)
      if (!result.changes) throw new Error('候选资料不存在。')
    } else if (action.kind === 'entity-candidate-confirm') {
      const result = db.prepare(`
        UPDATE story_entity_candidates
        SET status = 'confirmed', linked_entity_id = ?, updated_at = ?
        WHERE project_id = ? AND id = ?
      `).run(action.linkedEntityId, timestamp, projectId, action.entityId)
      if (!result.changes) throw new Error('候选资料不存在。')
    } else {
      throw new Error('不支持的世界状态操作。')
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function applyStateDelta(
  db: DatabaseSync,
  projectId: string,
  chapterIndex: number,
  delta: StateDelta
): void {
  const normalizedDelta = normalizeStateDelta(delta)
  db.exec('BEGIN')
  try {
  const timestamp = now()

  // 新人物/势力只进入项目级候选收件箱，不直接污染正式设定库。
  for (const candidate of normalizedDelta.entity_candidates ?? []) {
    upsertEntityCandidate(db, projectId, chapterIndex, candidate, timestamp)
  }

  // Character state updates
  for (const charUpdate of normalizedDelta.characters_updated) {
    const existing = getLatestCharacterStates(db, projectId, [charUpdate.character_id])
    const prev = existing[0]

    const id = uid()
    const location = charUpdate.changes.location?.to ?? prev?.location ?? ''
    const physicalState = charUpdate.changes.physical_state ?? prev?.physicalState ?? '正常'
    const mentalState = charUpdate.changes.mental_state ?? prev?.mentalState ?? ''
    const arcStage = charUpdate.changes.arc_progression ?? prev?.arcStage ?? ''
    const powerLevel = charUpdate.changes.power_level ?? prev?.powerLevel ?? ''

    let inventory = prev?.inventory ?? []
    if (charUpdate.changes.inventory_delta) {
      const { added = [], removed = [] } = charUpdate.changes.inventory_delta
      inventory = inventory.filter((item) => !removed.includes(item))
      inventory = [...new Set([...inventory, ...added])]
    }
    const inventoryJson = JSON.stringify(inventory)

    let knowledge = prev?.knowledge ?? []
    if (charUpdate.changes.new_knowledge?.length) {
      knowledge = [...new Set([...knowledge, ...charUpdate.changes.new_knowledge])]
    }
    const knowledgeJson = JSON.stringify(knowledge)

    let goals = prev?.goals ?? []
    if (charUpdate.changes.goals_update) {
      const { completed = [], added = [] } = charUpdate.changes.goals_update
      goals = goals.filter((g) => !completed.includes(g))
      goals = [...new Set([...goals, ...added])]
    }
    const goalsJson = JSON.stringify(goals)

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO story_character_state
        (id, project_id, character_id, chapter_index, location, physical_state, mental_state,
         arc_stage, power_level, knowledge_json, inventory_json, goals_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id, projectId, charUpdate.character_id, chapterIndex,
      location, physicalState, mentalState,
      arcStage, powerLevel,
      knowledgeJson, inventoryJson, goalsJson,
      timestamp
    )
  }

  // Relationship updates
  for (const relUpdate of normalizedDelta.relationships_delta) {
    const existingStmt = db.prepare(
      `SELECT * FROM story_relationships WHERE project_id = ? AND relationship_id = ?`
    )
    const existingRow = existingStmt.get(projectId, relUpdate.relationship_id) as Record<string, unknown> | undefined

    if (existingRow) {
      const updates: string[] = []
      const params: (string | number | null)[] = []
      const previousStatus = String(existingRow.current_status ?? '')
      const previousLifecycle = String(existingRow.lifecycle_status ?? 'active') as RelationshipLifecycleStatus

      if (relUpdate.status_change) {
        updates.push('current_status = ?')
        params.push(relUpdate.status_change.to)
      }
      if (relUpdate.new_tension_points?.length || relUpdate.resolved_tension_points?.length) {
        const resolved = new Set(relUpdate.resolved_tension_points ?? [])
        const existing = parseJson<string[]>(existingRow.tension_points_json, []).filter((item) => !resolved.has(item))
        updates.push('tension_points_json = ?')
        params.push(JSON.stringify([...new Set([...existing, ...(relUpdate.new_tension_points ?? [])])]))
      }
      const nextLifecycle = relUpdate.lifecycle ?? 'active'
      updates.push('lifecycle_status = ?', "lifecycle_managed_by = 'auto'")
      params.push(nextLifecycle)
      updates.push('last_interaction_chapter = ?')
      params.push(chapterIndex)
      updates.push('updated_at = ?')
      params.push(timestamp)
      params.push(projectId, relUpdate.relationship_id)

      if (updates.length >= 2) {
        db.prepare(
          `UPDATE story_relationships SET ${updates.join(', ')} WHERE project_id = ? AND relationship_id = ?`
        ).run(...params)
      }
      appendRelationshipHistory(db, {
        projectId,
        relationshipId: relUpdate.relationship_id,
        chapterIndex,
        fromStatus: relUpdate.status_change?.from || previousStatus,
        toStatus: relUpdate.status_change?.to || previousStatus,
        pivotEvent: relUpdate.status_change?.pivot_event,
        tensionsAdded: relUpdate.new_tension_points,
        tensionsResolved: relUpdate.resolved_tension_points,
        lifecycleFrom: previousLifecycle,
        lifecycleTo: nextLifecycle,
        source: 'ai'
      })
    } else if (relUpdate.participants) {
      db.prepare(`
        INSERT OR IGNORE INTO story_relationships
          (id, project_id, relationship_id, participant_a, participant_b, current_status,
           tension_points_json, trajectory, last_interaction_chapter, lifecycle_status,
           lifecycle_managed_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?)
      `).run(
        uid(), projectId, relUpdate.relationship_id,
        relUpdate.participants[0], relUpdate.participants[1],
        relUpdate.status_change?.to ?? '初识',
        JSON.stringify(relUpdate.new_tension_points ?? []),
        '', chapterIndex, relUpdate.lifecycle ?? 'active', timestamp
      )
      appendRelationshipHistory(db, {
        projectId,
        relationshipId: relUpdate.relationship_id,
        chapterIndex,
        toStatus: relUpdate.status_change?.to ?? '初识',
        pivotEvent: relUpdate.status_change?.pivot_event,
        tensionsAdded: relUpdate.new_tension_points,
        lifecycleTo: relUpdate.lifecycle ?? 'active',
        source: 'ai'
      })
    }
  }

  // Foreshadowing updates
  if (normalizedDelta.foreshadowing_delta) {
    for (const planted of normalizedDelta.foreshadowing_delta.planted) {
      db.prepare(`
        INSERT OR IGNORE INTO story_foreshadowing
          (id, project_id, foreshadowing_id, type, description, status, planted_chapter,
           planted_method, payoff_chapter, clues_json, connections_json, status_managed_by, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, '[]', '[]', 'auto', ?)
      `).run(
        uid(), projectId, planted.id, planted.type, planted.description,
        chapterIndex, planted.method, planted.payoff_chapter ?? null, timestamp
      )
    }

    for (const advanced of normalizedDelta.foreshadowing_delta.advanced) {
      const row = db.prepare(
        `SELECT clues_json FROM story_foreshadowing WHERE project_id = ? AND foreshadowing_id = ?`
      ).get(projectId, advanced.id) as Record<string, unknown> | undefined

      if (row) {
        const clues = parseJson<Foreshadowing['clues']>(row.clues_json, [])
        const nextClue = { chapter: chapterIndex, clue: advanced.clue, method: advanced.method }
        if (!clues.some((item) => item.chapter === nextClue.chapter && item.clue === nextClue.clue && item.method === nextClue.method)) {
          clues.push(nextClue)
        }
        db.prepare(`
          UPDATE story_foreshadowing
          SET clues_json = ?, status = 'advanced', status_managed_by = 'auto', updated_at = ?
          WHERE project_id = ? AND foreshadowing_id = ?
        `).run(JSON.stringify(clues), timestamp, projectId, advanced.id)
      }
    }

    for (const resolved of normalizedDelta.foreshadowing_delta.resolved) {
      db.prepare(`
        UPDATE story_foreshadowing
        SET status = 'resolved', resolved_chapter = ?, status_managed_by = 'auto', updated_at = ?
        WHERE project_id = ? AND foreshadowing_id = ?
      `).run(chapterIndex, timestamp, projectId, resolved.id)
    }
    for (const abandoned of normalizedDelta.foreshadowing_delta.abandoned) {
      db.prepare(`
        UPDATE story_foreshadowing
        SET status = 'abandoned', resolved_chapter = NULL, status_managed_by = 'auto', updated_at = ?
        WHERE project_id = ? AND foreshadowing_id = ?
      `).run(timestamp, projectId, abandoned.id)
    }
  }

  // Timeline
  if (normalizedDelta.timeline) {
    db.prepare(`
      INSERT OR REPLACE INTO story_timeline
        (id, project_id, chapter_index, story_date, events_json, world_state_changes_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid(), projectId, chapterIndex,
      normalizedDelta.timeline.current_story_date ?? '',
      JSON.stringify(normalizedDelta.timeline.events ?? []),
      JSON.stringify(normalizedDelta.timeline.world_state_changes ?? []),
      timestamp
    )
  }

  refreshAutomaticRelationshipLifecycle(db, projectId, chapterIndex)

  db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ==================== Context Builder ====================

export function buildStoryStateContext(
  db: DatabaseSync,
  projectId: string,
  involvedCharacterIds: string[]
): StoryStateContext {
  const allCharIds = involvedCharacterIds.length
    ? involvedCharacterIds
    : getAllCharacterIds(db, projectId)

  return {
    characterStates: getLatestCharacterStates(db, projectId, allCharIds),
    activeForeshadowing: getActiveForeshadowing(db, projectId),
    relationships: getRelationships(db, projectId, allCharIds),
    recentTimeline: getRecentTimeline(db, projectId, 5),
    worldRules: getWorldRules(db, projectId),
    activeClocks: getActiveClocks(db, projectId)
  }
}

/** 面向管理界面的完整状态视图；写作上下文仍只注入活跃伏笔和活跃关系。 */
export function buildStoryStateOverview(db: DatabaseSync, projectId: string): StoryStateOverview {
  const currentChapterIndex = getLatestStoryChapterIndex(db, projectId)
  refreshAutomaticRelationshipLifecycle(db, projectId, currentChapterIndex)
  const context = buildStoryStateContext(db, projectId, [])
  return {
    ...context,
    allForeshadowing: getAllForeshadowing(db, projectId),
    allRelationships: getRelationships(db, projectId, undefined, true, true),
    entityCandidates: getEntityCandidates(db, projectId)
  }
}

export function formatStoryStateForPrompt(ctx: StoryStateContext): string {
  const sections: string[] = []

  if (ctx.characterStates.length) {
    const lines = ctx.characterStates.map((c) => {
      const parts = [`${c.characterId}: 位置[${c.location || '未知'}]`]
      if (c.physicalState && c.physicalState !== '正常') parts.push(`身体[${c.physicalState}]`)
      if (c.mentalState) parts.push(`心理[${c.mentalState}]`)
      if (c.arcStage) parts.push(`阶段[${c.arcStage}]`)
      if (c.powerLevel) parts.push(`能力[${c.powerLevel}]`)
      if (c.inventory.length) parts.push(`持有[${c.inventory.join('、')}]`)
      if (c.goals.length) parts.push(`目标[${c.goals.join('、')}]`)
      return `- ${parts.join(', ')}`
    })
    sections.push(`### 角色当前状态\n${lines.join('\n')}`)
  }

  if (ctx.activeForeshadowing.length) {
    const lines = ctx.activeForeshadowing.slice(0, 15).map((f) => {
      const clueCount = f.clues.length
      const payoff = f.payoffChapter ? `预定第${f.payoffChapter}章揭示` : '揭示时间待定'
      return `- ${f.foreshadowingId}[${f.status}]: ${f.description} (第${f.plantedChapter}章埋设, 已释放${clueCount}条线索, ${payoff})`
    })
    sections.push(`### 活跃伏笔 (${ctx.activeForeshadowing.length}条)\n${lines.join('\n')}`)
  }

  if (ctx.relationships.length) {
    const lines = ctx.relationships.map((r) => {
      const tension = r.tensionPoints.length ? `, 矛盾[${r.tensionPoints.join('/')}]` : ''
      return `- ${r.participantA} ↔ ${r.participantB}: ${r.currentStatus}${tension}`
    })
    sections.push(`### 关系网络\n${lines.join('\n')}`)
  }

  if (ctx.recentTimeline.length) {
    const lines = ctx.recentTimeline.map((t) => {
      const date = t.storyDate ? `[${t.storyDate}]` : ''
      return `- 第${t.chapterIndex}章${date}: ${t.events.join('; ')}`
    })
    sections.push(`### 近期时间线\n${lines.join('\n')}`)
  }

  if (ctx.worldRules.length) {
    const lines = ctx.worldRules.map((r) => `- ${r.ruleContent} (第${r.establishedChapter}章确立)`)
    sections.push(`### 世界规则\n${lines.join('\n')}`)
  }

  if (ctx.activeClocks.length) {
    const lines = ctx.activeClocks.map((c) => {
      const deadline = c.deadlineChapter ? `截止第${c.deadlineChapter}章` : '无明确截止'
      return `- [${c.urgency}] ${c.eventDescription} (${deadline})`
    })
    sections.push(`### 倒计时事件\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}
