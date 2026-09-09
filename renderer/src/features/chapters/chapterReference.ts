import type {
  CharacterCard,
  CharacterRelationship,
  ChapterDraft,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  WorldviewEntry
} from '@/types/app'

export type ChapterReferenceCategory = 'all' | 'outline' | 'worldview' | 'character' | 'organization' | 'relationship'

export type ChapterReferenceKind = Exclude<ChapterReferenceCategory, 'all'> | 'membership'

export interface ChapterReferenceData {
  outline: OutlineItem | null
  outlines: OutlineItem[]
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
}

export interface ChapterReferenceItem {
  id: string
  kind: ChapterReferenceKind
  title: string
  label: string
  body: string
  searchableText: string
}

function uniqueIds(ids: string[] | undefined): Set<string> {
  return new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function sortByOrder<T extends { sortOrder?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
}

/**
 * 章节参考资料只依赖明确的大纲关联：关联角色会补充其关系、组织归属和关系另一端的角色。
 * 这样“本章相关”足够稳定，也不会因为正文里偶然出现一个词就误报关联设定。
 */
export function buildChapterReferenceData(input: {
  chapter?: ChapterDraft | null
  outlineItems: OutlineItem[]
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
}): ChapterReferenceData {
  const outline = input.outlineItems.find((item) => item.id === input.chapter?.outlineItemId) ?? null
  if (!outline) {
    return {
      outline: null,
      outlines: [],
      worldviewEntries: [],
      characters: [],
      organizations: [],
      characterRelationships: [],
      organizationMemberships: []
    }
  }

  const characterIds = uniqueIds(outline.relatedCharacterIds)
  const organizationIds = uniqueIds(outline.relatedOrganizationIds)
  const worldviewIds = uniqueIds(outline.relatedWorldviewIds)
  const relationships = input.characterRelationships.filter((relationship) =>
    characterIds.has(relationship.fromCharacterId) || characterIds.has(relationship.toCharacterId)
  )

  for (const relationship of relationships) {
    if (characterIds.has(relationship.fromCharacterId)) characterIds.add(relationship.toCharacterId)
    if (characterIds.has(relationship.toCharacterId)) characterIds.add(relationship.fromCharacterId)
  }

  const memberships = input.organizationMemberships.filter((membership) =>
    characterIds.has(membership.characterId) || organizationIds.has(membership.organizationId)
  )
  for (const membership of memberships) {
    organizationIds.add(membership.organizationId)
  }

  return {
    outline,
    outlines: [outline],
    worldviewEntries: sortByOrder(input.worldviewEntries.filter((entry) => worldviewIds.has(entry.id))),
    characters: input.characters.filter((character) => characterIds.has(character.id)),
    organizations: sortByOrder(input.organizations.filter((organization) => organizationIds.has(organization.id))),
    characterRelationships: relationships,
    organizationMemberships: memberships
  }
}

export function flattenChapterReferenceItems(
  data: ChapterReferenceData,
  mode: 'related' | 'all',
  allData: ChapterReferenceData
): ChapterReferenceItem[] {
  const source = mode === 'all' ? allData : data
  const characterNameById = new Map(allData.characters.map((character) => [character.id, character.name]))
  const organizationNameById = new Map(allData.organizations.map((organization) => [organization.id, organization.name]))
  const items: ChapterReferenceItem[] = []

  const outlines = source.outlines.length ? source.outlines : (source.outline ? [source.outline] : [])
  for (const outline of outlines) {
    items.push({
      id: `outline:${outline.id}`,
      kind: 'outline',
      title: outline.title || '未命名大纲',
      label: `大纲 · ${outline.status === 'done' ? '已完成' : outline.status === 'drafting' ? '写作中' : '规划中'}`,
      body: [outline.conflict && `冲突：${outline.conflict}`, outline.summary && `摘要：${outline.summary}`]
        .filter(Boolean)
        .join('\n') || '暂未填写大纲摘要。',
      searchableText: [outline.title, outline.conflict, outline.summary, outline.status].map(cleanText).join(' ')
    })
  }

  for (const entry of source.worldviewEntries) {
    items.push({
      id: `worldview:${entry.id}`,
      kind: 'worldview',
      title: entry.title || '未命名设定',
      label: `世界观 · ${entry.type || '未分类'}`,
      body: cleanText(entry.content) || '暂未填写设定内容。',
      searchableText: [entry.title, entry.type, entry.content].map(cleanText).join(' ')
    })
  }

  for (const character of source.characters) {
    items.push({
      id: `character:${character.id}`,
      kind: 'character',
      title: character.name || '未命名角色',
      label: `人物 · ${character.role || '未填写定位'}`,
      body: cleanText(character.description) || '暂未填写人物描述。',
      searchableText: [character.name, character.role, character.description, ...(character.tags ?? []).map((tag) => tag.label)]
        .map(cleanText)
        .join(' ')
    })
  }

  for (const organization of source.organizations) {
    items.push({
      id: `organization:${organization.id}`,
      kind: 'organization',
      title: organization.name || '未命名组织',
      label: `组织 · ${organization.type || '未分类'}`,
      body: [cleanText(organization.description), organization.motto && `信条：${cleanText(organization.motto)}`]
        .filter(Boolean)
        .join('\n') || '暂未填写组织描述。',
      searchableText: [organization.name, organization.type, organization.description, organization.motto]
        .map(cleanText)
        .join(' ')
    })
  }

  for (const relationship of source.characterRelationships) {
    const fromName = characterNameById.get(relationship.fromCharacterId) ?? '未命名角色'
    const toName = characterNameById.get(relationship.toCharacterId) ?? '未命名角色'
    items.push({
      id: `relationship:${relationship.id}`,
      kind: 'relationship',
      title: `${fromName} · ${relationship.type || '关系'} · ${toName}`,
      label: `人物关系 · 强度 ${relationship.intensity ?? 0}`,
      body: cleanText(relationship.description) || '暂未填写关系描述。',
      searchableText: [fromName, toName, relationship.type, relationship.description, relationship.intensity]
        .map(cleanText)
        .join(' ')
    })
  }

  for (const membership of source.organizationMemberships) {
    const characterName = characterNameById.get(membership.characterId) ?? '未命名角色'
    const organizationName = organizationNameById.get(membership.organizationId) ?? '未命名组织'
    items.push({
      id: `membership:${membership.id}`,
      kind: 'membership',
      title: `${characterName} · ${organizationName}`,
      label: `组织归属 · ${membership.role || '未填写身份'}`,
      body: cleanText(membership.notes) || '暂未填写归属备注。',
      searchableText: [characterName, organizationName, membership.role, membership.notes]
        .map(cleanText)
        .join(' ')
    })
  }

  return items
}

export function getChapterReferenceCategory(kind: ChapterReferenceKind): ChapterReferenceCategory {
  return kind === 'membership' ? 'relationship' : kind
}
