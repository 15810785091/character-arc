<script setup lang="ts">
import { ref } from 'vue'
import { BookMarked, FileCheck2, Globe2, Lightbulb, Network, Users } from 'lucide-vue-next'
import CharactersPanel from './CharactersPanel.vue'
import InspirationPanel from './InspirationPanel.vue'
import PlotThreadsPanel from './PlotThreadsPanel.vue'
import ProjectKnowledgePanel from './ProjectKnowledgePanel.vue'
import RelationsPanel from './RelationsPanel.vue'
import WorldviewPanel from './WorldviewPanel.vue'

defineProps<{ searchQuery?: string }>()

type StoryDataTab = 'characters' | 'world' | 'relations' | 'threads' | 'inspiration' | 'knowledge'

const activeTab = ref<StoryDataTab>('characters')
const tabs = [
  { id: 'characters', label: '人物', icon: Users },
  { id: 'world', label: '世界观', icon: Globe2 },
  { id: 'relations', label: '关系与势力', icon: Network },
  { id: 'threads', label: '伏笔线索', icon: BookMarked },
  { id: 'inspiration', label: '灵感', icon: Lightbulb },
  { id: 'knowledge', label: '知识健康', icon: FileCheck2 }
] as const
</script>

<template>
  <section class="story-bible">
    <header class="story-bible-head">
      <div>
        <span class="story-bible-kicker">项目事实源</span>
        <h2>故事资料</h2>
        <p>人物、世界规则、势力关系与伏笔统一在这里维护，AI 会按当前任务自动检索。</p>
      </div>
      <nav class="story-tabs" aria-label="故事资料分类">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" :size="14" />
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <div class="story-bible-content">
      <CharactersPanel v-if="activeTab === 'characters'" :search-query="searchQuery" />
      <WorldviewPanel v-else-if="activeTab === 'world'" :search-query="searchQuery" />
      <RelationsPanel v-else-if="activeTab === 'relations'" :search-query="searchQuery" />
      <PlotThreadsPanel v-else-if="activeTab === 'threads'" :search-query="searchQuery" />
      <InspirationPanel v-else-if="activeTab === 'inspiration'" :search-query="searchQuery" />
      <ProjectKnowledgePanel v-else />
    </div>
  </section>
</template>

<style scoped>
.story-bible {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 18px;
}

.story-bible-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid var(--arc-border);
  padding-bottom: 14px;
}

.story-bible-kicker {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.story-bible h2 {
  margin: 3px 0 0;
  color: var(--arc-text-primary);
  font-size: 21px;
}

.story-bible p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.story-tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.story-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 7px 9px;
  font-size: 12px;
}

.story-tabs button:hover,
.story-tabs button.active {
  border-color: color-mix(in srgb, var(--arc-primary) 44%, var(--arc-border));
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.story-bible-content {
  min-height: 0;
}

@media (max-width: 980px) {
  .story-bible-head {
    align-items: stretch;
    flex-direction: column;
  }

  .story-tabs {
    justify-content: flex-start;
  }
}
</style>
