import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  applyStateDelta,
  buildStoryStateOverview,
  initStoryStateSchema,
  normalizeStateDelta,
  refreshAutomaticRelationshipLifecycle,
  updateStoryStateLifecycle
} from './story-state-store.ts'

test('畸形状态增量会被规范化为可遍历、可绑定的字段', () => {
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: { value: '紧张' },
        arc_progression: ['第一阶段'],
        new_knowledge: ['密道', '密道', { value: '无效' }]
      }
    }],
    foreshadowing_delta: {
      planted: null,
      advanced: { id: '伏笔-1', clue: '旧信出现', method: '侧写' },
      resolved: '无'
    },
    timeline: { events: '抵达城门' }
  })

  assert.deepEqual(delta.foreshadowing_delta.advanced, [{ id: '伏笔-1', clue: '旧信出现', method: '侧写' }])
  assert.equal(delta.characters_updated[0].changes.mental_state, undefined)
  assert.deepEqual(delta.characters_updated[0].changes.new_knowledge, ['密道'])
  assert.deepEqual(delta.timeline.events, [])
})

test('同一章节状态增量重复写入不会重复累积数组字段', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: '警觉',
        inventory_delta: { added: ['旧信'], removed: [] },
        new_knowledge: ['密道入口'],
        goals_update: { completed: [], added: ['找到证人'] }
      }
    }],
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      status_change: { from: '陌生', to: '合作', pivot_event: '共同脱险' },
      new_tension_points: ['互不信任']
    }],
    foreshadowing_delta: {
      planted: [{ id: '伏笔-1', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 20 }],
      advanced: [{ id: '伏笔-1', clue: '火漆印', method: '特写' }],
      resolved: []
    },
    timeline: { current_story_date: '第三日', events: ['离城'] }
  })

  applyStateDelta(db, 'project-1', 3, delta)
  applyStateDelta(db, 'project-1', 3, delta)

  const character = db.prepare('SELECT knowledge_json, inventory_json, goals_json FROM story_character_state').get()
  const relationship = db.prepare('SELECT tension_points_json FROM story_relationships').get()
  const foreshadowing = db.prepare('SELECT clues_json FROM story_foreshadowing').get()
  assert.deepEqual(JSON.parse(character.knowledge_json), ['密道入口'])
  assert.deepEqual(JSON.parse(character.inventory_json), ['旧信'])
  assert.deepEqual(JSON.parse(character.goals_json), ['找到证人'])
  assert.deepEqual(JSON.parse(relationship.tension_points_json), ['互不信任'])
  assert.deepEqual(JSON.parse(foreshadowing.clues_json), [{ chapter: 3, clue: '火漆印', method: '特写' }])
})

test('长期无互动关系自动休眠归档，新互动会自动唤醒并保留历史', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const relationshipDelta = (status = '合作') => normalizeStateDelta({
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      status_change: { from: '', to: status, pivot_event: '共同脱险' },
      new_tension_points: ['互不信任']
    }]
  })

  applyStateDelta(db, 'project-1', 2, relationshipDelta())
  refreshAutomaticRelationshipLifecycle(db, 'project-1', 14)
  assert.equal(db.prepare('SELECT lifecycle_status FROM story_relationships').get().lifecycle_status, 'dormant')

  refreshAutomaticRelationshipLifecycle(db, 'project-1', 32)
  assert.equal(db.prepare('SELECT lifecycle_status FROM story_relationships').get().lifecycle_status, 'archived')

  applyStateDelta(db, 'project-1', 33, relationshipDelta('重新合作'))
  const overview = buildStoryStateOverview(db, 'project-1')
  assert.equal(overview.relationships.length, 1)
  assert.equal(overview.allRelationships[0].lifecycleStatus, 'active')
  assert.ok(overview.allRelationships[0].history.length >= 4)

  updateStoryStateLifecycle(db, 'project-1', {
    kind: 'relationship-lifecycle', entityId: '林岚-顾川', status: 'archived'
  })
  refreshAutomaticRelationshipLifecycle(db, 'project-1', 100)
  assert.equal(buildStoryStateOverview(db, 'project-1').allRelationships[0].lifecycleStatus, 'archived')

  updateStoryStateLifecycle(db, 'project-1', {
    kind: 'relationship-lifecycle', entityId: '林岚-顾川', status: 'auto'
  })
  const restored = buildStoryStateOverview(db, 'project-1').allRelationships[0]
  assert.equal(restored.lifecycleStatus, 'active')
  assert.equal(restored.lifecycleManagedBy, 'auto')
})

test('伏笔回收和废弃会进入归档视图且不再注入写作上下文', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  applyStateDelta(db, 'project-1', 3, normalizeStateDelta({
    foreshadowing_delta: {
      planted: [{ id: '旧信', type: '暗线', description: '带火漆印的旧信', method: '特写' }]
    }
  }))

  updateStoryStateLifecycle(db, 'project-1', {
    kind: 'foreshadowing-status',
    entityId: '旧信',
    status: 'resolved'
  })
  const overview = buildStoryStateOverview(db, 'project-1')
  assert.equal(overview.activeForeshadowing.length, 0)
  assert.equal(overview.allForeshadowing[0].status, 'resolved')
  assert.equal(overview.allForeshadowing[0].statusManagedBy, 'manual')
})

test('解决关系张力会从当前状态移除并写入变化历史', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  applyStateDelta(db, 'project-1', 1, normalizeStateDelta({
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      new_tension_points: ['互不信任']
    }]
  }))

  updateStoryStateLifecycle(db, 'project-1', {
    kind: 'relationship-resolve-tension',
    entityId: '林岚-顾川',
    tensionPoint: '互不信任'
  })
  const relationship = buildStoryStateOverview(db, 'project-1').allRelationships[0]
  assert.deepEqual(relationship.tensionPoints, [])
  assert.deepEqual(relationship.history[0].tensionsResolved, ['互不信任'])
})

test('正文实体先观察、跨章再次出现后进入待建档，重复扫描同章不重复计数', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const candidateDelta = normalizeStateDelta({
    entity_candidates: [{
      kind: 'character',
      name: '林砚',
      aliases: ['小砚'],
      role_or_type: '药铺学徒',
      description: '向主角递交密信。',
      source_quote: '林砚把密信压在药包下面。',
      has_dialogue: true
    }]
  })

  applyStateDelta(db, 'project-1', 3, candidateDelta)
  applyStateDelta(db, 'project-1', 3, candidateDelta)
  let candidate = buildStoryStateOverview(db, 'project-1').entityCandidates[0]
  assert.equal(candidate.status, 'observing')
  assert.equal(candidate.chapterCount, 1)
  assert.equal(candidate.evidence.length, 1)

  applyStateDelta(db, 'project-1', 4, candidateDelta)
  candidate = buildStoryStateOverview(db, 'project-1').entityCandidates[0]
  assert.equal(candidate.status, 'pending')
  assert.equal(candidate.chapterCount, 2)
  assert.deepEqual(candidate.aliases, ['小砚'])
})

test('泛称和没有原文依据的名字不会进入候选资料', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  applyStateDelta(db, 'project-1', 1, normalizeStateDelta({
    entity_candidates: [
      { kind: 'character', name: '黑衣人', source_quote: '黑衣人转身离开。', plot_impact: true },
      { kind: 'character', name: '顾川', source_quote: '陌生少年转身离开。', plot_impact: true }
    ]
  }))
  assert.deepEqual(buildStoryStateOverview(db, 'project-1').entityCandidates, [])
})

test('明确影响剧情的命名势力首次出现即可待确认，忽略后重复扫描不会再次提醒', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const delta = normalizeStateDelta({
    entity_candidates: [{
      kind: 'organization',
      name: '白塔议会',
      role_or_type: '城邦议会',
      source_quote: '白塔议会封锁了所有出城道路。',
      plot_impact: true
    }]
  })
  applyStateDelta(db, 'project-1', 1, delta)
  let candidate = buildStoryStateOverview(db, 'project-1').entityCandidates[0]
  assert.equal(candidate.status, 'pending')

  updateStoryStateLifecycle(db, 'project-1', {
    kind: 'entity-candidate-status', entityId: candidate.id, status: 'ignored'
  })
  applyStateDelta(db, 'project-1', 2, delta)
  candidate = buildStoryStateOverview(db, 'project-1').entityCandidates[0]
  assert.equal(candidate.status, 'ignored')
  assert.equal(candidate.chapterCount, 2)
})
