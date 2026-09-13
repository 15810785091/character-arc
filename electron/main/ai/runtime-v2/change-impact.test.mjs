import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachImpactWarnings,
  buildDeleteImpactWarnings,
  buildOutlineUpdateImpactWarnings,
  readImpactWarnings
} from './change-impact.ts'

const workspace = {
  chapters: [{ id: 'ch-1', outlineItemId: 'o-1', title: '第一章' }],
  outlineItems: [{
    id: 'o-1',
    title: '节点一',
    relatedCharacterIds: ['c-1'],
    relatedOrganizationIds: ['org-1'],
    relatedWorldviewIds: ['w-1']
  }],
  characterRelationships: [{ fromCharacterId: 'c-1', toCharacterId: 'c-2' }],
  organizationMemberships: [{ characterId: 'c-1', organizationId: 'org-1' }]
}

test('deleting a referenced character reports all dependency categories', () => {
  const warnings = buildDeleteImpactWarnings(workspace, 'character', 'c-1')
  assert.equal(warnings.length, 3)
  assert.match(warnings.join('\n'), /大纲/)
  assert.match(warnings.join('\n'), /人物关系/)
  assert.match(warnings.join('\n'), /组织归属/)
})

test('deleting a bound outline reports affected chapters', () => {
  assert.match(buildDeleteImpactWarnings(workspace, 'outline', 'o-1')[0], /第一章/)
})

test('changing summary without changing a non-empty conflict warns', () => {
  assert.equal(buildOutlineUpdateImpactWarnings({
    previousSummary: '旧剧情', nextSummary: '新剧情', previousConflict: '旧冲突', nextConflict: '旧冲突'
  }).length, 1)
  assert.equal(buildOutlineUpdateImpactWarnings({
    previousSummary: '旧剧情', nextSummary: '新剧情', previousConflict: '旧冲突', nextConflict: ''
  }).length, 0)
})

test('impact warnings survive inside the staged entity payload', () => {
  const payload = attachImpactWarnings({ title: '节点' }, ['提示'])
  assert.deepEqual(readImpactWarnings(payload), ['提示'])
})
