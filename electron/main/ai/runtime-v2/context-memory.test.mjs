import assert from 'node:assert/strict'
import test from 'node:test'

import { buildConversationMemory, buildProjectDigest } from './context-memory.ts'

test('对话工作记忆保留最近六轮，并压缩更早内容', () => {
  const turns = Array.from({ length: 10 }, (_, index) => ({
    userMessage: `用户第${index + 1}轮：${'甲'.repeat(400)}`,
    assistantMessage: `助理第${index + 1}轮：${'乙'.repeat(400)}`
  }))
  const memory = buildConversationMemory(turns)

  assert.match(memory, /较早对话索引（已压缩）/)
  assert.match(memory, /用户第1轮/)
  assert.match(memory, /用户第5轮/)
  assert.match(memory, /用户第10轮/)
  assert.ok(memory.length < 9_000)
})

test('项目小结从源数据派生进度、后续大纲和约束索引', () => {
  const digest = buildProjectDigest({
    project: {
      id: 'project-1', title: '元素至高', genre: '玄幻', targetPlatform: '番茄',
      wordCount: '', novelLength: 'long', lastEdited: '', cover: '', coverHistory: [],
      writingStylePresetId: '', writingStylePrompt: '', novelWorkflowStages: [],
      projectSkills: [], skillPolicy: { mode: 'auto', skillIds: [] },
      chapterAssistantTemplates: [], selectedReferenceWorkIds: []
    },
    workspace: {
      worldviewEntries: [{ id: 'world-1', type: '规则', title: '元素等级', content: '规则正文', sortOrder: 1, createdAt: '', updatedAt: '' }],
      characters: [{ id: 'char-1', name: '陆烬', role: '主角', description: '风火双系学员', avatar: '', tags: [] }],
      organizations: [], characterRelationships: [], organizationMemberships: [], inspirationEntries: [],
      outlineVolumes: [{ id: 'volume-1', title: '学院生活', wordTarget: '', summary: '学院成长阶段', workflowDocuments: [] }],
      outlineItems: [
        { id: 'outline-1', volumeId: 'volume-1', title: '入学', wordTarget: '', conflict: '', summary: '进入学院', relatedCharacterIds: ['char-1'], status: 'done', sortOrder: 1 },
        { id: 'outline-2', volumeId: 'volume-1', title: '年末赛', wordTarget: '', conflict: '争夺名次', summary: '参加个人赛', relatedCharacterIds: ['char-1'], status: 'planned', sortOrder: 2 }
      ],
      chapters: [{ id: 'chapter-1', outlineItemId: 'outline-1', volumeId: 'volume-1', title: '入学日', summary: '陆烬进入学院', status: 'draft', wordTarget: '', content: '<p>正文内容</p>' }],
      chapterVersions: [], messages: [], globalAssistantSessions: [], activeGlobalAssistantSessionId: '', aiRuns: [], workflowDocuments: [],
      plotThreads: [{ id: 'thread-1', title: '神秘符文', description: '尚未解开的符文来源', openedInChapterId: 'chapter-1', status: 'open', closedInChapterId: '', tags: [], createdAt: '', updatedAt: '' }]
    },
    knowledgeDocuments: [{
      id: 'constraint-1', projectId: 'project-1', title: '等级规则', sourceType: 'canon-fact', sourceLabel: 'global-constraint',
      content: '晋级必须完成测试', summary: '', keywords: [], metadata: {}, createdAt: '', updatedAt: ''
    }],
    scopeRef: 'chapter:chapter-1'
  })

  assert.match(digest, /正文约 4 字/)
  assert.match(digest, /当前进度：【入学日】/)
  assert.match(digest, /接下来尚未成章的大纲/)
  assert.match(digest, /【年末赛】/)
  assert.match(digest, /【等级规则】/)
  assert.match(digest, /自动派生的小结/)
})
