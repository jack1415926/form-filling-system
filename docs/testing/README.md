# 测试说明

更新日期：2026-10-20。此页维护当前测试入口与最近执行结果；具体修复原因、数据职责及保留依据见[关键回归](REGRESSIONS.md)，未解决问题见[待办](../REQUIREMENTS-REFACTOR-TODO.md)。

## 当前验证

2026-10-20实际异常处理核对：后端全量真实MySQL **188项通过**，独立测试库已销毁；前端全量 **141项通过**，lint及TypeScript／Vite构建通过。此次覆盖实际API错误分类、保存队列、读取／保存响应、提交与任务确认、审核、发布／ECO创建、交接和反馈的未知结果恢复，未改后端业务规则。

修复内容：五类正文入口（概述／详情、物料列表、27题、EMC、执行计划）在缓存与渲染前校验读取／保存响应，拒绝不完整200响应，保留旧缓存和脏输入；提交／任务确认／审核查询及交接缺失回执提示明确查询已执行；ECO创建信息合并保留回执及填写人，另一操作已创建或发布权限／轮次改变时结束不可重试状态，不冒认原请求成功。故障脚本HTTP默认空正文，以核对应用状态码提示；指定body仍用于核对后端明细。

新增fault-injection测试11项直接运行实际Snippet和api，覆盖全部10种模式、匹配边界、清空／撤销、超时、转发及重新安装；response-safety两项覆盖多组非法响应、缓存和保存输入保护，publication补充并发／迟到回执回归。独立Edge的模拟接口验证共10项：五类读取损坏与恢复，ECR／ECO各两种提交丢失路径，以及实际PublicationPanel的并发创建后解除未知／忙碌状态；无页面崩溃，不写开发业务库。真实多设备网络、所有弹窗视觉位置及完整用户业务验收不由这些结果替代。

[异常清单](FAULT-INJECTION.md)是开发索引，按场景组映射自动化，不要求用户逐项故障注入。旧DevTools Snippet须替换为当前脚本重新安装，clear只移除规则、不升级脚本。

2026-10-20待发布入口修复：前端全量127项、lint与TypeScript／Vite构建通过；后端真实MySQL专项26项通过（test_review_inbox、test_publication、test_eco_stage、test_round_snapshots），测试库已销毁，未重跑后端全量。新增回归覆盖ECR／ECO、发布人与发起人相同／不同、消息分类与已读、发布列表／正文读取、非指定发布人拒绝及发布后退出待办。

独立Edge浏览器使用模拟接口完成12种正向组合（ECR／ECO × 发布人与发起人相同／不同 × 消息／待我发布／工程变更），验证进入当前发布区、确认发布后按钮消失；消息入口另验证同一流程已打开历史页时回到总览。另12种反向组合验证历史轮次、非指定发布人及已发布列表不显示发布按钮；模拟发布没有写入业务库，不等同于真实会话完整端到端及用户业务验收。

线框图1.4.drawio核对了全部16页，并更新第04、05、15页三处跳转／权限说明；XML解析通过，其他页面与几何布局不变。登录页原型HTML／PNG不受本次发布入口修复影响。

2026-10-19身份恢复与错误分类：前端全量126项、lint与TypeScript／Vite构建通过；后端`changes.test_api_errors`五项通过，均为不访问数据库的SimpleTestCase，未重跑全量MySQL测试。模拟接口浏览器验证了普通403不误报登录失效、重新登录前请求迟到不重开提示，以及同账号重新登录保留输入并恢复自动保存；不等同于真实会话和完整业务验收。人工触发方式及错误码边界见[保存与身份](REGRESSIONS.md#保存与身份)。

本项目后端已重启加载新配置，经当前Vite代理核验未登录身份接口401、未登录业务接口403／not_authenticated、缺少CSRF的登录接口403／csrf_failed；未登录真实账号、未写业务数据。

以下保留2026-10-16整理批次的结果：

| 检查 | 整理前 | 整理后 |
| --- | --- | --- |
| 后端全量真实MySQL | 183项通过 | 182项通过，独立测试库已销毁 |
| 前端全量Node测试 | 118项通过 | 103项通过 |
| 文档链接／片段、测试命令、代码差异 | — | 全部本地链接与片段有效，命令入口有效，diff检查通过 |
| 当前序列图 | — | 两幅重写序列图通过Mermaid语法解析，未重新渲染历史图片 |

两轮均在2026-10-16本机运行；不混用更早批次的测试总数，不以数量减少承诺固定耗时提升。本批未改产品业务源码、模型或迁移，未运行浏览器端到端和业务人工验收。前一批职责整理的lint／TypeScript／Vite构建通过，本批未重复构建。

## 运行

异常提示与手动触发方法见[异常界面与故障注入清单](FAULT-INJECTION.md)，附独立浏览器Snippet。该清单是代码审阅与操作指引，不代表逐项测试已经执行。

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
| 认证与错误分类 | test_api_errors（无需数据库） | api、autosave |
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
