import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChapterReferenceData, flattenChapterReferenceItems } from './chapterReference.ts'

const baseInput = {
  chapter: { id: 'chapter-1', outlineItemId: 'outline-1' },
  outlineItems: [{
    id: 'outline-1',
    volumeId: 'volume-1',
    title: '雨夜追查旧案',
    wordTarget: '3000',
    conflict: '林澈必须在封锁前找到证人。',
    summary: '旧案线索指向港口。',
    relatedCharacterIds: ['character-lin'],
    relatedOrganizationIds: [],
    relatedWorldviewIds: ['world-port'],
    status: 'planned',
    sortOrder: 1
  }, {
    id: 'outline-2',
    volumeId: 'volume-1',
    title: '港口封锁',
    wordTarget: '2000',
    conflict: '守城军封锁港口。',
    summary: '另一条大纲。',
    status: 'idea',
    sortOrder: 2
  }],
  worldviewEntries: [
    { id: 'world-port', type: '地理', title: '灰潮港', content: '夜间有雾潮。', sortOrder: 1 },
    { id: 'world-law', type: '法则', title: '潮汐法则', content: '无关设定。', sortOrder: 2 }
  ],
  characters: [
    { id: 'character-lin', name: '林澈', role: '调查者', description: '追查旧案。', avatar: '', tags: [] },
    { id: 'character-qiao', name: '乔知夏', role: '证人', description: '掌握线索。', avatar: '', tags: [] }
  ],
  organizations: [
    { id: 'org-guard', name: '守城军', type: '官方势力', description: '负责封锁。', motto: '', color: '', sortOrder: 1 },
    { id: 'org-guild', name: '旧港商会', type: '商会', description: '无关组织。', motto: '', color: '', sortOrder: 2 }
  ],
  characterRelationships: [{
    id: 'relation-1', fromCharacterId: 'character-lin', toCharacterId: 'character-qiao', type: '合作', description: '互相利用。', intensity: 70
  }],
  organizationMemberships: [{
    id: 'membership-1', characterId: 'character-lin', organizationId: 'org-guard', role: '临时协查', notes: '只在本案期间有效。'
  }]
}

test('本章相关资料会补充关系另一端和组织归属', () => {
  const related = buildChapterReferenceData(baseInput)
  assert.deepEqual(related.characters.map((item) => item.id), ['character-lin', 'character-qiao'])
  assert.deepEqual(related.organizations.map((item) => item.id), ['org-guard'])
  assert.equal(related.characterRelationships.length, 1)
  assert.equal(related.organizationMemberships.length, 1)
})

test('全量资料包含全部大纲并可按分类检索', () => {
  const related = buildChapterReferenceData(baseInput)
  const allData = {
    ...related,
    outlines: baseInput.outlineItems,
    worldviewEntries: baseInput.worldviewEntries,
    characters: baseInput.characters,
    organizations: baseInput.organizations,
    characterRelationships: baseInput.characterRelationships,
    organizationMemberships: baseInput.organizationMemberships
  }
  const items = flattenChapterReferenceItems(related, 'all', allData)
  assert.equal(items.filter((item) => item.kind === 'outline').length, 2)
  assert.equal(items.find((item) => item.title === '潮汐法则')?.kind, 'worldview')
  assert.match(items.find((item) => item.title === '林澈')?.searchableText ?? '', /调查者/)
})
