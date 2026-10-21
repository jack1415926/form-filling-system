# 测试说明

更新日期：2026-10-21。此页只维护当前测试入口、最新已执行结果及边界；修复原因见[关键回归](REGRESSIONS.md)，完整业务与部署验收见[待办](../REQUIREMENTS-REFACTOR-TODO.md)。

## 当前验证

以下为2026-10-21代码修复后的本机验证；表中单独标明的历史专项保留原执行日期。

| 检查 | 最近结果与范围 |
| --- | --- |
| 后端全量真实MySQL | 196项通过，独立测试库已销毁；含权限、回执、事务、并发、历史及迁移回归 |
| 前端全量Node测试 | 143项通过；含API错误分类、保存输入、缓存顺序、版本／轮次、响应校验和原请求恢复 |
| 前端lint／TypeScript／Vite构建 | 通过；保留构建产物体积提示，不据此宣称完成性能优化 |
| 发布入口模拟浏览器（2026-10-20记录，本轮未重跑） | 12种正向组合：ECR／ECO × 发布人与发起人相同／不同 × 消息／待我发布／工程变更；另12种反向组合验证历史、非发布人及已发布不显示发布按钮 |
| 实际异常组件的模拟浏览器（2026-10-20记录，本轮未重跑） | 10项：五类残缺读取与恢复、ECR／ECO各两种提交丢失路径、PublicationPanel并发创建后解除未知／忙碌状态；未写开发业务库 |
| 修复场景组件浏览器 | 5项通过：退回后保留任务输入并明确确认放弃、确认后刷新历史、新物料丢失回包后先确认创建再保存新修改、ECR新建丢失回包后复用UUID、来源ECR多人结果只读展示；全部API模拟 |
| 迁移与数据核验 | 本机已应用0029；29张业务表、226列，原有列的数据摘要迁移前后一致；创建回执非空时禁止逆迁移丢失去重证据 |

发布入口已统一到当前流程总览，历史继续只读。异常处理验证包括：拒绝残缺200读取／保存响应、保留旧缓存与脏输入、查询不补发写入、原请求重试、迟到读取保留ECO创建回执，以及条件改变后结束不可重试状态。故障脚本的11项测试覆盖全部10种模式；response-safety两项测试包含多组非法响应、缓存及保存输入保护。

这些结果不替代真实多设备网络、所有弹窗视觉位置或完整用户业务验收。不沿用历史批次测试总数，不要求用户重复逐页注入错误。

## 线框图核验

[当前线框图](../线框图1.4.drawio)共17页。第05、09、13—16页同步查询／重试、输入保留、响应不完整、发布／ECO条件变化及历史只读；第13、16页扩展说明区域。第17页覆盖独立系统反馈的提交、共用列表、用户追加、管理员公开处理，以及未读、版本更新、结果未知和管理权限撤销。

第17页126个元素可独立编辑，追加时前16页内容逐页保持。XML、ID／父级引用、按坐标生成的浏览器预览及目视核对通过；新增／修改文字未发现溢出或遮挡。该检查只验证图形结构与说明，不等于业务验收；旧版本素材不覆盖，本机预览不作为现行源文件。

## 运行

优先运行自动化；[异常场景索引](FAULT-INJECTION.md)及独立DevTools脚本用于定点排查，不作为用户逐项手测清单。替换脚本后需重新安装Snippet，clear只清规则。

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

修复组件回归在前端开发服务启动后运行`node scripts/review-fixes-browser.cjs`；若Playwright不在项目模块中，用`PLAYWRIGHT_MODULE`指定已有模块路径。测试临时页面在结束时删除，所有API隔离模拟，不写开发库。

按改动选择专项，例如 `npm.cmd run test:questions`、`npm.cmd run test:contracts`；后端可传 `changes.test_round_snapshots` 等模块。改变产品代码时另运行lint／构建；只改文档和测试，不反复启动页面或生成业务样例。

## 测试地图

| 领域 | 后端changes模块 | 前端tests文件 |
| --- | --- | --- |
| 登录／概述／编号 | tests | api、response-contracts、latest-response、request-id、date-validation |
| 认证与错误分类 | test_api_errors（无需数据库）及真实会话／CSRF业务测试 | api、autosave |
| 残缺响应与故障模拟 | 各领域接口的校验／事务回归 | response-safety、fault-injection（实际运行Snippet与api） |
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

## 测试保留与维护

- 当前阶段提交、确认与未知结果恢复保留ecr-stage／ecr-recovery／eco-stage；旧整单提交／公开审核模拟不再维护。
- 多人来源证据、问题缓存、反馈、固定模板等回归保留在各自现行领域测试，不以整理文件为由删除真实行为断言。
- 物料删除与整项删除职责分开；真实CSRF、父锁后的权限重检、事务隔离及并发不能由普通成功路径替代。
- 同一主题更新本页或REGRESSIONS，不新增逐批流水账；技术结果不关闭用户业务验收。代码、文档和图稿是否已提交／推送，以实际Git状态为准。

0029专项验证旧记录清理、单负责人转存多人集合、指定审核及快照保留、混合历史拒绝自动删除、旧接口拒绝和账号删除保护。停用的单人字段转换测试随旧函数移除，相关元数据校验统一验证多人集合；143项与此前144项的差异来自这项清理。
