import type { SurfaceDefinition } from '@shared/assistant-runtime'

/**
 * 项目级助手的统一 Surface 配置。
 *
 * 页面与侧边栏必须共用同一份轮数配置，避免某个入口遗留旧的 8 轮上限。
 */
export const GLOBAL_ASSISTANT_SURFACE: SurfaceDefinition = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}
