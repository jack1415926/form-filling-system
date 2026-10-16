# 测试说明

更新日期：2026-10-16。此页维护当前测试入口与最近执行结果；具体修复原因、数据职责及保留依据见[关键回归](REGRESSIONS.md)，未解决问题见[待办](../REQUIREMENTS-REFACTOR-TODO.md)。

## 当前验证

| 检查 | 整理前 | 整理后 |
| --- | --- | --- |
| 后端全量真实MySQL | 183项通过 | 182项通过，独立测试库已销毁 |
| 前端全量Node测试 | 118项通过 | 103项通过 |
| 文档链接／片段、测试命令、代码差异 | — | 全部本地链接与片段有效，命令入口有效，diff检查通过 |
| 当前序列图 | — | 两幅重写序列图通过Mermaid语法解析，未重新渲染历史图片 |

两轮均在2026-10-16本机运行；不混用更早批次的测试总数，不以数量减少承诺固定耗时提升。本批未改产品业务源码、模型或迁移，未运行浏览器端到端和业务人工验收。前一批职责整理的lint／TypeScript／Vite构建通过，本批未重复构建。

## 运行

根目录执行后端全量：

```powershell
pwsh -NoProfile -File scripts/backend.ps1 test changes --noinput
```

测试使用本机配置中的DB_TEST_NAME，必须与开发库不同。先确认没有其他工作占用该测试库；测试会创建并销毁它。MySQL连接或权限失败不算通过，也不改用SQLite冒充验证。环境安装与迁移见[开发说明](../DEVELOPMENT.md)。

前端目录执行：

```powershell
npm.cmd test
# 当前沙箱若禁止启动子进程，使用同进程收集全部测试
node --test --test-isolation=none tests/*.test.mjs
```

按改动选择专项，例如 `npm.cmd run test:questions`、`npm.cmd run test:contracts`；后端可传 `changes.test_round_snapshots` 等模块。改变产品代码时另运行lint／构建；只改文档和测试，不反复启动页面或生成业务样例。

## 测试地图

| 领域 | 后端changes模块 | 前端tests文件 |
| --- | --- | --- |
| 登录／概述／编号 | tests | api、response-contracts、latest-response、request-id、date-validation |
| 物料／处置 | test_materials | material-save、autosave |
| 问题／模板 | test_questions、test_emc、test_execution_plan、test_significant_change、test_dates | question-draft、template-definitions、execution-plan、significant-change |
| 阶段／多人／来源 | test_ecr_stage、test_eco_stage、test_multi_owner_approval、test_publication | ecr-stage、ecr-recovery、eco-stage、action-owner、publication |
| 列表／交接／接收提醒 | test_engineering_changes、test_eco_filler、test_filler_inbox | engineering-changes、eco-filler |
| 正式意见／审核消息 | test_review_issues、test_review_inbox | review、review-inbox |
| 完整轮次快照 | test_round_snapshots | round-snapshots |
| 整项删除／停用入口 | test_engineering_deletion、test_retirement | engineering-changes |
| 独立反馈／样例生成 | test_system_feedback、test_seed_workflow | system-feedback |
| 结构／历史迁移 | test_migrations、test_structural_migrations、test_action_owners、test_snapshot_migration及业务模块中的迁移守卫 | — |

后端`test_case_views.py`是开发测试数据接口，虽然名称以test开头，但不是测试套件，不能因清理测试而删除。迁移测试及并发测试验证的是不同风险，不能由普通成功路径替代。

## 本次精简

- 删除旧整单提交／公开提交恢复路径的前端模拟；现行checkedChange／checkedReviewers校验保留为response-contracts。当前阶段提交与未知结果恢复继续由ecr-stage／ecr-recovery／eco-stage覆盖。
- browser-feedback的三个断言组并入api、eco-stage、significant-change；问题缓存回归并入question-draft；多人来源证据并入publication；行动定义与EMC表头合并为template-definitions。删除对应旧文件并更新npm命令。
- 后端五项审核修复并入test_multi_owner_approval，保留真实事务隔离；仅删除test_materials中重复的草稿级联／编号释放测试，由整项删除专项覆盖。未确认删除的真实CSRF及并发断言保留并明确命名。
- 按日期分散的验证流水账合并为本页和REGRESSIONS；源表映射、当前规则、待办、部署边界保留在对应文档。已移除的旧原型、旧机器状态和旧计数不再维护独立说明。

后续维护在相应主题补充必要信息；不新增停用测试归档或每小批一份Markdown。Git提交／推送状态以Git记录为准。
