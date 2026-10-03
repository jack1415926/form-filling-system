// Shared fixed definitions.
import actions from '../../backend/changes/ecr_actions.json' with { type: 'json' }
export const ECR_ACTIONS = actions

export const DEMO_QUESTIONS = [
  {
    "number": 1,
    "text": "该变更影响设备铭牌或安规标签。"
  },
  {
    "number": 6,
    "text": "该变更对现有物料号（包括软件）进行升版，或者该变更创建新的物料号。"
  },
  {
    "number": 18,
    "text": "该变更影响内部的生产装配过程、生产测试过程、质量控制计划、进货检验、SOP、生产工具、生产工装、生产仪器设备、操作员培训材料或工时。"
  }
]
