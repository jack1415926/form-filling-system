# 表单填报系统技术文档：架构、数据与处理流程

更新日期：2026-10-20。本文作为技术审阅入口，覆盖系统架构、代码模块、数据结构、保存链路和历史权限；2026-10-20只读核对，本机changes迁移已应用至0027；0027移除旧普通留言表review_feedback。功能与验证状态见[README](../README.md)，业务规则见[MVP](MVP.md)，安装／启动／迁移见[开发说明](DEVELOPMENT.md)，原Excel坐标见[字段映射](FIELD_MAP.md)。

## 系统架构

系统将设计变更Excel工作表转换为网页，业务流程为ECR评估、批准与发布，再基于已发布ECR创建独立ECO执行流程。ECR和ECO各有自己的填写人、编号、任务、审核轮次及发布证据。

| 层次 | 技术与职责 |
| --- | --- |
| 页面 | React、TypeScript、Ant Design；TanStack Query管理读取缓存，输入和保存队列分别管理 |
| 前端服务 | Vite开发服务及构建；公司内网演示经前端代理访问/api |
| 业务接口 | Django REST Framework；Session认证、CSRF校验、账号／申请／轮次／任务授权 |
| 数据库 | MySQL 8.4、utf8mb4、InnoDB；事务、外键、唯一约束和检查约束共同维护数据一致性 |
| 运行与更新 | Python虚拟环境、Node.js和PowerShell启动脚本；数据库结构通过Django迁移管理 |

```mermaid
flowchart LR
    U[浏览器] --> F[React界面 / Vite]
    F -->|/api代理| A[Django REST接口]
    A -->|事务与约束| D[(MySQL)]
```

公司内网当前用于演示与审阅：只开放前端入口，后端和数据库保持本机监听；不是正式生产部署。账号、密钥、数据库和备份使用本机配置，不通过Git同步。当前访问地址和验证边界见[内网访问记录](COMPANY-LAN.md)。

## 代码地图：想改什么，先找哪里

| 范围 | 前端入口 | 后端入口 |
| --- | --- | --- |
| 登录、工作台与页签 | App.tsx、api.ts | views.py、permissions.py、signals.py |
| 基础概述与物料／处置 | App.tsx、submission.ts的checkedChange、MaterialEditor.tsx、materialSave.ts、DispositionFields.tsx | views.py、serializers.py、dispositions.py |
| 27题及批量回答 | QuestionEditor.tsx、autosaveFields.ts、questionDraft.ts、queryRefresh.ts | questions.py、views.py |
| ECR／ECO任务 | StageWorkflow.tsx、ecrStage.ts；ECO内EcrEditor只读展示来源ECR | stage_workflow.py、stage_actions.py、ecr.py／eco.py及两份行动JSON |
| 发布与事务复制 | PublicationPanel.tsx、publication.ts | publication.py |
| 整项永久删除 | EngineeringChanges、DeleteEngineeringChangeDialog、App.tsx | ChangeDetail.delete；先删关联ECO、再删ECR，保留事务和来源保护关系 |
| 六阶段及来源摘要 | StageNavigation.tsx、stageNavigationData.ts | stage_navigation.py |
| 正式意见与历史 | ReviewPanel.tsx、review.ts、ReviewWorkbench.tsx | review_access.py、review_views.py、review_issues.py |
| 完整轮次快照 | RoundSnapshotForm.tsx、roundSnapshots.ts；独立只读缓存 | round_snapshots.py、ReviewRound.form_snapshot及0026迁移 |
| 消息与已读 | ReviewInbox.tsx、reviewInboxData.ts、App.tsx入口选择；发布类列表经ReviewWorkbench进入当前总览 | review_inbox.py |
| EMC、计划、实质性评估 | EmcEditor、ExecutionPlanEditor、SignificantChangeEditor及对应草稿模块 | emc_views、execution_plan_views、significant_change_views及固定定义 |
| 独立系统反馈 | SystemFeedbackPanel.tsx、systemFeedback.ts | system_feedback_views.py |
| 保存与切页 | useAutosave.ts、autosave.ts、SaveBeforeSwitch.tsx、latestResponse.ts | 各写接口的事务／父申请锁 |
| 通用请求校验／冲突 | api.ts；questionDraft／materialSave／emcMatrix／executionPlanDraft及各领域响应校验 | request_values.py；各业务专用校验仍独立 |

前端入口位于`frontend/src/`，后端业务位于`backend/changes/`；URL在[urls.py](../backend/backend/urls.py)，结构与约束在[models.py](../backend/changes/models.py)。旧整单提交、旧role及停用脚本／测试归档已删除；账号名单接口仍用于选择有效用户，不按旧角色授权。当前未使用路由框架，刷新重建React页面状态，已保存内容从MySQL读取。

## 先理解业务数据组

| 数据组 | 业务表及职责 |
| --- | --- |
| ECO交接 | eco_filler_event记录创建、历史基线及填写人交接；行动负责人及批准人集合另有三张关联表 |
| 申请与基础 | change_request保存阶段、来源、编号和发布证据；material_change／material_disposition按物料与位置独立保存；question_response保存27题 |
| 行动与轮次 | ecr_action_response／eco_action_response保存当前值；review_round冻结轮次；review_record保存参与关系；action_task按轮保存负责人／结果／确认；task_operation保存原请求回执 |
| 意见与提醒 | review_issue／review_issue_event保留原提出者、回应与解决过程；旧普通留言表review_feedback已在0027移除；review_inbox_read按账号／轮次保存消息签名 |
| 评估 | execution_plan_response保存11条计划；significant_assessment／significant_chart_response／significant_question_response分开保存人工总论、组论和逐题填写 |
| EMC | emc_reference及row／test／cell四表保存本单定义和交叉格，复合外键防止跨参考关联 |
| 系统反馈 | system_feedback／system_feedback_event／system_feedback_read保存独立双向沟通和入站已读版本 |

2026-10-16只读核验：当前0027为26个业务模型及3张人员关联表，共29张业务表、230个实际字段，58条外键约束涉及60个外键列；0025增加ECO填写权限提醒的已读表，0026在review_round增加完整表单JSON快照。[完整字段与关系](design/DATABASE-ER-FULL.md)及其Mermaid源已更新到0027，包含多人关联、交接、提醒及完整快照；旧图片仍为历史结构；当前结构以models.py和迁移文件为准。用户、会话、组、权限、迁移记录是系统表。八张Excel不等于八张数据库表，也不等于八个网页页签：概述／物料拆开，实质性主表／子表合为分组抽屉。

## 一次保存怎样到达数据库

例如只清空`company_finished`备注：页面比较当前值与保存基线，发送`{"dispositions":{"company_finished":{"remark":""}}}`，省略的处置NA保持不变。API附Cookie、CSRF和X-Expected-User；后端事务锁住父申请、核对归属和状态，再校验并保存物料／处置；任何部分失败全部回滚。返回响应经过身份和结构校验才更新基线，请求期间的新输入保留。

| 机制 | 作用与边界 |
| --- | --- |
| 归属／轮次／任务授权 | 决定谁能读取或处理；staff／superuser不绕过业务授权 |
| X-Expected-User | 拒绝页面账号与Cookie不一致的写入；它不是授权凭据 |
| request_id | 确认原请求、避免重复新增；同UUID不同载荷409，物料号不用于新增去重 |
| 局部PATCH、串行队列 | 只保存差异，显式空值清空；停顿2秒、有限重试、手动保存等待在途请求 |
| updated_at缓存顺序 | 保留较新响应，包括微秒精度；干净编辑器同步，脏／在途／未知输入保留 |
| version | 行动任务另有版本和UUID保护；基础表同字段仍是后保存者生效，没有通用多人冲突控制 |

API总期限30秒覆盖CSRF、请求和响应正文；写超时是结果未确认，不等于没有写入。Form／React state是输入，Query缓存是读取快照，MySQL才是持久数据；离开提醒不是异常退出后的本地备份。

## 异常处理与恢复定位

API按错误状态和认证标记区分处理：401、认证403及CSRF失败触发原账号恢复；普通业务403保留具体原因。成功状态码不等于业务结果已确认：完整结构和原请求凭据通过校验后才能更新基线，残缺响应不覆盖已有缓存或脏输入。超时期限包括CSRF、请求及响应正文。

| 场景 | 主要代码与约束 |
| --- | --- |
| 保存失败／有限重试 | autosave.ts、useAutosave.ts；保留输入与在途编辑，普通保存与业务确认的重试策略分开 |
| 提交／任务确认未知 | StageWorkflow.tsx、ecrStage.ts；查询不补写，确认原UUID优先，轮次或版本改变时结束不可重试状态 |
| 审核／意见未知 | ReviewPanel.tsx、review.ts；核对原操作、权限和意见版本，不冒认他人操作为本次成功 |
| 发布／ECO创建未知 | PublicationPanel.tsx、publication.ts；来源时间戳不变时仍保留ECO关联、填写人及创建回执，条件改变后停止不能继续的重试 |
| ECO交接／独立反馈未知 | EcoFillerPanel.tsx、SystemFeedbackPanel.tsx及各自回执校验；读不到回执不等于未执行，权限撤销不恢复操作能力 |

专项测试位置与最新执行结果见[测试说明](testing/README.md)，开发排查配方见[异常场景索引](testing/FAULT-INJECTION.md)，原因与保留依据见[关键回归](testing/REGRESSIONS.md)。

## 阶段与历史

两阶段各自的填写表、编号、发布人和轮次独立。提交冻结正文快照与任务分配，确认／意见解决决定批准，发布另有明确动作。待发布消息使用publication上下文，发布类列表直接进入当前流程总览，与工程变更共用PublicationPanel；历史轮次继续由ReviewPanel／RoundSnapshotForm只读展示。ECO基于已发布ECR事务复制基础（含27题答案和备注），来源结果只读引用。ECO后续修改不回写来源ECR；批量全是／全否仅在显式点击后修改当前记录，保留备注。

0026起，新提交在同一事务和父申请锁内保存概述、各子表内容／定义及行动分配的版本化JSON；action_task和意见事件继续保存对应轮次的逐人结果与审核过程。重复请求不重写快照，新轮另存。批准／退回记录使用同一只读历史界面，快照缓存与当前正文分离，不能自动保存或读取正在修订的新正文。

完整快照只向目标轮次参与者及已有正文职责的发起人、发布人、协调人员开放；新轮指派本身不能获得未参与旧轮的全文权限。旧轮没有快照时明确显示缺失，不用当前正文补造历史。已有完整快照时，逆迁移拒绝删除这些证据。

导航不授予相邻阶段正文权限。仅ECO参与者的来源入口只读概述和行动结果；完整ECR历史仍受原权限控制。完整流程见[阶段图](design/STAGES-CURRENT.md)。

## 界面审阅与日常维护

[当前线框图](线框图1.4.drawio)共17页：01—04为登录／工作台／列表，05—13为流程总览、填写及提交，14—15为审核历史，16为异常恢复，17为独立反馈与管理。它展示当前功能和条件状态，不替代真实权限校验、自动化结果或用户业务验收。旧版本素材及本机预览不作为现行实现依据。

## 日常开发与历史证据

先明确小批终点，核对源表／代码，确定归属及空值语义，再做窄改动。验证先覆盖受影响路径，有新风险或失败时再扩大；区分真实MySQL、模拟页面、真实页面与用户业务验收。公开日志不要粘贴Cookie、密码或本机配置。

练习可用自己的草稿追踪“标题”或“处置备注”的页面→API→serializer→model链路，并用另一临时账号核对授权拒绝。不要拿正式样例做删除练习。

自动化入口与最新执行结果见[测试说明](testing/README.md)，修复原因及保留依据集中在[关键回归](testing/REGRESSIONS.md)。
