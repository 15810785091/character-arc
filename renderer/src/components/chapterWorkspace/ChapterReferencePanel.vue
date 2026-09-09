<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BookOpen, Building2, FileText, Globe2, Network, Search, Users, X } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import {
  buildChapterReferenceData,
  flattenChapterReferenceItems,
  getChapterReferenceCategory,
  type ChapterReferenceCategory,
  type ChapterReferenceItem
} from '@/features/chapters/chapterReference'

const emit = defineEmits<{ close: [] }>()
const appStore = useAppStore()
const mode = ref<'related' | 'all'>('related')
const category = ref<ChapterReferenceCategory>('all')
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelGeometry = ref<PanelGeometry | null>(null)
const isDragging = ref(false)
const isResizing = ref(false)

const MIN_WIDTH = 280
const MIN_HEIGHT = 260
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 560
const EDGE_GAP = 8
const GEOMETRY_STORAGE_KEY = 'arc-chapter-reference-geometry'

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface PanelGeometry {
  left: number
  top: number
  width: number
  height: number
}

interface ParentBounds {
  width: number
  height: number
}

const categoryOptions: Array<{ id: ChapterReferenceCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'worldview', label: '世界观' },
  { id: 'character', label: '人物' },
  { id: 'organization', label: '组织' },
  { id: 'relationship', label: '关系' },
  { id: 'outline', label: '大纲' }
]

const icons = { outline: FileText, worldview: Globe2, character: Users, organization: Building2, relationship: Network, membership: Network }

const relatedData = computed(() => buildChapterReferenceData({
  chapter: appStore.selectedChapter,
  outlineItems: appStore.outlineItems,
  worldviewEntries: appStore.worldviewEntries,
  characters: appStore.characters,
  organizations: appStore.organizations,
  characterRelationships: appStore.characterRelationships,
  organizationMemberships: appStore.organizationMemberships
}))

const allData = computed(() => ({
  outline: appStore.outlineItems.find((item) => item.id === appStore.selectedChapter?.outlineItemId) ?? null,
  outlines: [...appStore.outlineItems],
  worldviewEntries: [...appStore.worldviewEntries],
  characters: [...appStore.characters],
  organizations: [...appStore.organizations],
  characterRelationships: [...appStore.characterRelationships],
  organizationMemberships: [...appStore.organizationMemberships]
}))

const allItems = computed(() => flattenChapterReferenceItems(relatedData.value, 'all', allData.value))
const relatedItems = computed(() => flattenChapterReferenceItems(relatedData.value, 'related', allData.value))
const visibleItems = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase()
  return (mode.value === 'all' ? allItems.value : relatedItems.value).filter((item) => {
    const matchesCategory = category.value === 'all' || getChapterReferenceCategory(item.kind) === category.value
    const matchesQuery = !normalizedQuery || `${item.title} ${item.label} ${item.searchableText}`.toLocaleLowerCase().includes(normalizedQuery)
    return matchesCategory && matchesQuery
  })
})

const counts = computed(() => {
  const items = mode.value === 'all' ? allItems.value : relatedItems.value
  return categoryOptions.reduce<Record<string, number>>((result, option) => {
    result[option.id] = option.id === 'all'
      ? items.length
      : items.filter((item) => getChapterReferenceCategory(item.kind) === option.id).length
    return result
  }, {})
})

const chapterLabel = computed(() => appStore.selectedChapter?.title || '未选择章节')
const relatedEmpty = computed(() => relatedItems.value.length === 0)

const panelStyle = computed(() => {
  if (!panelGeometry.value) return undefined
  return {
    left: `${panelGeometry.value.left}px`,
    top: `${panelGeometry.value.top}px`,
    width: `${panelGeometry.value.width}px`,
    height: `${panelGeometry.value.height}px`
  }
})

function itemIcon(item: ChapterReferenceItem) {
  return icons[item.kind]
}

function switchMode(nextMode: 'related' | 'all'): void {
  mode.value = nextMode
  category.value = 'all'
}

function closePanel(): void {
  emit('close')
}

function getParentBounds(): ParentBounds | null {
  const parent = panelRef.value?.parentElement
  if (!parent) return null
  const rect = parent.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}

function getMinWidth(bounds: ParentBounds): number {
  return Math.min(MIN_WIDTH, Math.max(220, bounds.width - EDGE_GAP * 2))
}

function getMinHeight(bounds: ParentBounds): number {
  return Math.min(MIN_HEIGHT, Math.max(180, bounds.height - EDGE_GAP * 2))
}

function clampGeometry(geometry: PanelGeometry, bounds: ParentBounds): PanelGeometry {
  const minWidth = getMinWidth(bounds)
  const minHeight = getMinHeight(bounds)
  const width = Math.min(Math.max(geometry.width, minWidth), Math.max(minWidth, bounds.width - EDGE_GAP * 2))
  const height = Math.min(Math.max(geometry.height, minHeight), Math.max(minHeight, bounds.height - EDGE_GAP * 2))
  const left = Math.min(Math.max(geometry.left, EDGE_GAP), Math.max(EDGE_GAP, bounds.width - width - EDGE_GAP))
  const top = Math.min(Math.max(geometry.top, EDGE_GAP), Math.max(EDGE_GAP, bounds.height - height - EDGE_GAP))
  return { left, top, width, height }
}

function persistGeometry(): void {
  if (panelGeometry.value) {
    localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(panelGeometry.value))
  }
}

function readSavedGeometry(): PanelGeometry | null {
  try {
    const saved = JSON.parse(localStorage.getItem(GEOMETRY_STORAGE_KEY) || '') as Partial<PanelGeometry>
    if ([saved.left, saved.top, saved.width, saved.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return { left: saved.left!, top: saved.top!, width: saved.width!, height: saved.height! }
    }
  } catch {
    // 忽略损坏的旧布局数据，使用默认位置和大小
  }
  return null
}

function initializeGeometry(): void {
  const bounds = getParentBounds()
  if (!bounds) return
  const minWidth = getMinWidth(bounds)
  const minHeight = getMinHeight(bounds)
  const defaultGeometry: PanelGeometry = {
    left: Math.max(EDGE_GAP, bounds.width - Math.min(DEFAULT_WIDTH, bounds.width - EDGE_GAP * 2) - 16),
    top: 52,
    width: Math.min(DEFAULT_WIDTH, Math.max(minWidth, bounds.width - EDGE_GAP * 2)),
    height: Math.min(DEFAULT_HEIGHT, Math.max(minHeight, bounds.height - 52 - 44))
  }
  panelGeometry.value = clampGeometry(readSavedGeometry() ?? defaultGeometry, bounds)
  persistGeometry()
}

function updateGeometry(nextGeometry: PanelGeometry, bounds = getParentBounds()): void {
  if (!bounds) return
  panelGeometry.value = clampGeometry(nextGeometry, bounds)
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const bounds = getParentBounds()
  const startGeometry = panelGeometry.value
  if (!bounds || !startGeometry) return
  event.preventDefault()
  isDragging.value = true
  const startX = event.clientX
  const startY = event.clientY

  const onMove = (moveEvent: PointerEvent) => {
    updateGeometry({
      ...startGeometry,
      left: startGeometry.left + moveEvent.clientX - startX,
      top: startGeometry.top + moveEvent.clientY - startY
    }, bounds)
  }
  const onEnd = () => {
    isDragging.value = false
    persistGeometry()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onEnd)
    document.removeEventListener('pointercancel', onEnd)
  }

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'move'
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onEnd)
  document.addEventListener('pointercancel', onEnd)
}

function startResize(direction: ResizeDirection, event: PointerEvent): void {
  if (event.button !== 0) return
  const bounds = getParentBounds()
  const startGeometry = panelGeometry.value
  if (!bounds || !startGeometry) return
  event.preventDefault()
  isResizing.value = true
  const startX = event.clientX
  const startY = event.clientY
  const resizeLeft = direction.includes('w')
  const resizeTop = direction.includes('n')

  const onMove = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX
    const deltaY = moveEvent.clientY - startY
    let width = startGeometry.width + (direction.includes('e') ? deltaX : resizeLeft ? -deltaX : 0)
    let height = startGeometry.height + (direction.includes('s') ? deltaY : resizeTop ? -deltaY : 0)
    const minWidth = getMinWidth(bounds)
    const minHeight = getMinHeight(bounds)
    width = Math.min(Math.max(width, minWidth), Math.max(minWidth, bounds.width - EDGE_GAP * 2))
    height = Math.min(Math.max(height, minHeight), Math.max(minHeight, bounds.height - EDGE_GAP * 2))

    updateGeometry({
      left: resizeLeft ? startGeometry.left + startGeometry.width - width : startGeometry.left,
      top: resizeTop ? startGeometry.top + startGeometry.height - height : startGeometry.top,
      width,
      height
    }, bounds)
  }
  const onEnd = () => {
    isResizing.value = false
    persistGeometry()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onEnd)
    document.removeEventListener('pointercancel', onEnd)
  }

  document.body.style.userSelect = 'none'
  document.body.style.cursor = getComputedStyle(event.currentTarget as Element).cursor
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onEnd)
  document.addEventListener('pointercancel', onEnd)
}

let resizeObserver: ResizeObserver | null = null

function syncGeometryToParent(): void {
  if (panelGeometry.value) {
    updateGeometry(panelGeometry.value)
  }
}

watch(
  () => appStore.selectedChapter?.id,
  () => {
    query.value = ''
    category.value = 'all'
  }
)

watch(mode, (nextMode) => {
  if (nextMode === 'all') {
    void nextTick(() => searchInput.value?.focus())
  }
})

onMounted(() => {
  void nextTick(() => {
    initializeGeometry()
    const parent = panelRef.value?.parentElement
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncGeometryToParent)
      resizeObserver.observe(parent)
    }
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
})
</script>

<template>
  <aside ref="panelRef" class="chapter-reference-panel" :style="panelStyle" :class="{ dragging: isDragging, resizing: isResizing }" aria-label="章节设定参考" @keydown.esc.stop="closePanel">
    <header class="reference-header" @pointerdown="startDrag">
      <div class="reference-heading">
        <span class="reference-heading-icon"><BookOpen :size="15" /></span>
        <div>
          <strong>设定参考</strong>
          <span>{{ chapterLabel }}</span>
        </div>
      </div>
      <button type="button" class="reference-close" aria-label="关闭设定参考" title="关闭" @click="closePanel">
        <X :size="16" />
      </button>
    </header>

    <div class="reference-mode" role="tablist" aria-label="资料范围">
      <button type="button" :class="{ active: mode === 'related' }" role="tab" :aria-selected="mode === 'related'" @click="switchMode('related')">
        本章相关
        <span>{{ relatedItems.length }}</span>
      </button>
      <button type="button" :class="{ active: mode === 'all' }" role="tab" :aria-selected="mode === 'all'" @click="switchMode('all')">
        全部资料
        <span>{{ allItems.length }}</span>
      </button>
    </div>

    <div class="reference-search">
      <Search :size="14" />
      <input ref="searchInput" v-model="query" type="search" aria-label="搜索设定资料" placeholder="搜索标题、分类或描述" />
      <button v-if="query" type="button" class="clear-search" aria-label="清空搜索" title="清空搜索" @click="query = ''">
        <X :size="13" />
      </button>
    </div>

    <nav class="reference-categories" aria-label="资料分类">
      <button
        v-for="option in categoryOptions"
        :key="option.id"
        type="button"
        :class="{ active: category === option.id }"
        :aria-pressed="category === option.id"
        @click="category = option.id"
      >
        {{ option.label }}
        <span>{{ counts[option.id] }}</span>
      </button>
    </nav>

    <div class="reference-scroll arc-scrollbar">
      <div v-if="relatedEmpty && mode === 'related'" class="reference-empty">
        <BookOpen :size="24" />
        <strong>还没有本章关联资料</strong>
        <p>先在大纲节点中关联人物、组织或世界观设定。</p>
        <button type="button" @click="switchMode('all')">查看全部资料</button>
      </div>
      <div v-else-if="visibleItems.length === 0" class="reference-empty">
        <Search :size="22" />
        <strong>没有找到匹配资料</strong>
        <p>换个关键词，或切换到其他资料分类。</p>
      </div>
      <div v-else class="reference-list">
        <article v-for="item in visibleItems" :key="item.id" class="reference-item">
          <div class="reference-item-head">
            <span class="reference-item-icon"><component :is="itemIcon(item)" :size="14" /></span>
            <div class="reference-item-title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.label }}</span>
            </div>
          </div>
          <p v-for="(line, index) in item.body.split('\n')" :key="`${item.id}-${index}`">{{ line }}</p>
        </article>
      </div>
    </div>

    <span class="resize-handle resize-n" aria-hidden="true" @pointerdown.stop="startResize('n', $event)" />
    <span class="resize-handle resize-ne" aria-hidden="true" @pointerdown.stop="startResize('ne', $event)" />
    <span class="resize-handle resize-e" aria-hidden="true" @pointerdown.stop="startResize('e', $event)" />
    <span class="resize-handle resize-se" aria-hidden="true" @pointerdown.stop="startResize('se', $event)" />
    <span class="resize-handle resize-s" aria-hidden="true" @pointerdown.stop="startResize('s', $event)" />
    <span class="resize-handle resize-sw" aria-hidden="true" @pointerdown.stop="startResize('sw', $event)" />
    <span class="resize-handle resize-w" aria-hidden="true" @pointerdown.stop="startResize('w', $event)" />
    <span class="resize-handle resize-nw" aria-hidden="true" @pointerdown.stop="startResize('nw', $event)" />
  </aside>
</template>

<style scoped>
.chapter-reference-panel {
  position: absolute;
  z-index: 40;
  top: 52px;
  right: 16px;
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 0;
  height: 560px;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-lg);
}

.reference-header,
.reference-mode,
.reference-search,
.reference-categories {
  flex-shrink: 0;
}

.reference-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--arc-border);
  cursor: move;
  user-select: none;
  touch-action: none;
}

.reference-heading,
.reference-heading > div,
.reference-item-head,
.reference-item-title {
  display: flex;
  min-width: 0;
}

.reference-heading,
.reference-item-head {
  align-items: center;
  gap: 9px;
}

.reference-heading-icon,
.reference-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.reference-heading > div,
.reference-item-title {
  flex-direction: column;
  gap: 2px;
}

.reference-heading strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}

.reference-heading span:last-child {
  max-width: 240px;
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-close,
.clear-search {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.reference-close:hover,
.clear-search:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.reference-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  margin: 10px 12px 8px;
  padding: 3px;
  border-radius: 6px;
  background: var(--arc-bg-surface-hover);
}

.reference-mode button,
.reference-categories button {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 11px;
}

.reference-mode button {
  min-height: 30px;
  border-radius: 4px;
}

.reference-mode button.active,
.reference-mode button:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-primary);
  box-shadow: var(--arc-shadow-sm);
}

.reference-mode span,
.reference-categories span {
  margin-left: 3px;
  color: var(--arc-text-hint);
  font-variant-numeric: tabular-nums;
}

.reference-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 12px 8px;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid var(--arc-border);
  border-radius: 5px;
  color: var(--arc-text-hint);
}

.reference-search:focus-within {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 14%, transparent);
}

.reference-search input {
  min-width: 0;
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 12px;
}

.reference-search input::placeholder {
  color: var(--arc-text-hint);
}

.clear-search {
  width: 24px;
  height: 24px;
}

.chapter-reference-panel.dragging,
.chapter-reference-panel.resizing {
  user-select: none;
}

.resize-handle {
  position: absolute;
  z-index: 5;
  display: block;
  touch-action: none;
}

.resize-handle:hover {
  background: color-mix(in srgb, var(--arc-primary) 18%, transparent);
}

.resize-n,
.resize-s {
  right: 10px;
  left: 10px;
  height: 8px;
  cursor: ns-resize;
}

.resize-n {
  top: 0;
}

.resize-s {
  bottom: 0;
}

.resize-e,
.resize-w {
  top: 10px;
  bottom: 10px;
  width: 8px;
  cursor: ew-resize;
}

.resize-e {
  right: 0;
}

.resize-w {
  left: 0;
}

.resize-ne,
.resize-nw,
.resize-se,
.resize-sw {
  width: 14px;
  height: 14px;
}

.resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.resize-se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}

.resize-sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.reference-categories {
  display: flex;
  gap: 2px;
  padding: 0 12px 9px;
  overflow-x: auto;
  scrollbar-width: none;
}

.reference-categories::-webkit-scrollbar {
  display: none;
}

.reference-categories button {
  min-height: 27px;
  padding: 0 7px;
  border-radius: 4px;
  white-space: nowrap;
}

.reference-categories button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.reference-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 14px;
}

.reference-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reference-item {
  padding: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-weak);
}

.reference-item-icon {
  width: 25px;
  height: 25px;
  border-radius: 5px;
}

.reference-item-title strong {
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-item-title span {
  color: var(--arc-text-hint);
  font-size: 10px;
  line-height: 1.3;
}

.reference-item p {
  margin: 8px 0 0 34px;
  color: var(--arc-text-secondary);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.reference-empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 8px;
  padding: 46px 18px;
  color: var(--arc-text-hint);
  text-align: center;
}

.reference-empty strong {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.reference-empty p {
  max-width: 230px;
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}

.reference-empty button {
  min-height: 30px;
  margin-top: 4px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  border-radius: 5px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11px;
}

@media (max-width: 640px) {
  .chapter-reference-panel {
    width: calc(100% - 16px);
    height: calc(100% - 16px);
  }
}
</style>
