# 项目代码与数据流指南

更新日期：2026-10-13。功能与验证状态只维护在[README](../README.md)，业务规则见[MVP](MVP.md)，安装／启动／迁移见[开发说明](DEVELOPMENT.md)，原Excel坐标见[字段映射](FIELD_MAP.md)。本文保留接手代码需要的地图与机制。

## 代码地图：想改什么，先找哪里

| 范围 | 前端入口 | 后端入口 |
| --- | --- | --- |
| 登录、工作台与页签 | App.tsx、api.ts | views.py、permissions.py、signals.py |
| 基础概述与物料／处置 | App.tsx、MaterialEditor.tsx、DispositionFields.tsx | views.py、serializers.py、dispositions.py |
| 27题 | QuestionEditor.tsx、questionDraft.ts | questions.py、views.py |
| ECR／ECO任务 | StageWorkflow.tsx、ecrStage.ts；旧编辑器服务legacy | stage_workflow.py、ecr.py／eco.py及两份行动JSON |
| 发布与事务复制 | PublicationPanel.tsx、publication.ts | publication.py |
| 六阶段及来源摘要 | StageNavigation.tsx、stageNavigationData.ts | stage_navigation.py |
| 正式意见与历史 | ReviewPanel.tsx、review.ts、ReviewWorkbench.tsx | review_access.py、review_views.py、review_issues.py |
| 消息与已读 | ReviewInbox.tsx、reviewInboxData.ts | review_inbox.py |
| EMC、计划、实质性评估 | EmcEditor、ExecutionPlanEditor、SignificantChangeEditor及对应草稿模块 | emc_views、execution_plan_views、significant_change_views及固定定义 |
| 独立系统反馈 | SystemFeedbackPanel.tsx、systemFeedback.ts | system_feedback_views.py |
| 保存与切页 | useAutosave.ts、autosave.ts、SaveBeforeSwitch.tsx、latestResponse.ts | 各写接口的事务／父申请锁 |

前端入口位于`frontend/src/`，后端业务位于`backend/changes/`；URL在[urls.py](../backend/backend/urls.py)，结构与约束在[models.py](../backend/changes/models.py)。当前未使用路由框架，刷新重建React页面状态，已保存内容从MySQL读取。

## 先理解二十五个业务表

| 数据组 | 业务表及职责 |
| --- | --- |
| 申请与基础 | change_request保存阶段、来源、编号和发布证据；material_change／material_disposition按物料与位置独立保存；question_response保存27题 |
| 行动与轮次 | ecr_action_response／eco_action_response保存当前值；review_round冻结轮次；review_record保存参与关系；action_task按轮保存负责人／结果／确认；task_operation保存原请求回执 |
| 意见与提醒 | review_issue／review_issue_event保留原提出者、回应与解决过程；review_feedback仅旧留言；review_inbox_read按账号／轮次保存消息签名 |
| 评估 | execution_plan_response保存11条计划；significant_assessment／significant_chart_response／significant_question_response分开保存人工总论、组论和逐题填写 |
| EMC | emc_reference及row／test／cell四表保存本单定义和交叉格，复合外键防止跨参考关联 |
| 系统反馈 | system_feedback／system_feedback_event／system_feedback_read保存独立双向沟通和入站已读版本 |

[完整字段与关系](design/DATABASE-ER-FULL.md)使用0021结构；用户、会话、组、权限、迁移记录是系统表。八张Excel不等于八张数据库表，也不等于八个网页页签：概述／物料拆开，实质性主表／子表合为分组抽屉。

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

## 阶段与历史

两阶段各自的填写表、编号、发布人和轮次独立。提交冻结任务，确认／意见解决决定批准，发布另有明确动作；ECO基于已发布ECR事务复制基础，结果只读引用。基础表没有完整逐轮快照，action_task和意见事件保存逐轮证据。退回表格显示当前分配，旧负责人和确认只在历史中解释。

导航不授予相邻阶段正文权限。仅ECO参与者的来源入口只读概述和行动结果；完整ECR历史仍受原权限控制。完整流程见[阶段图](design/STAGES-CURRENT.md)。

## 日常开发与历史证据

先明确小批终点，核对源表／代码，确定归属及空值语义，再做窄改动。验证先覆盖受影响路径，有新风险或失败时再扩大；区分真实MySQL、模拟页面、真实页面与用户业务验收。公开日志不要粘贴Cookie、密码或本机配置。

练习可用自己的草稿追踪“标题”或“处置备注”的页面→API→serializer→model链路，并用另一临时账号核对授权拒绝。不要拿正式样例做删除练习。

分批过程、历史样例及独有验证数字统一保留在[历史索引](testing/HISTORY.md)及[验证目录](testing/README.md)，不在当前指南重复旧业务规则和测试日志。
