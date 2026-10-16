# 当前数据库完整字段与关系（0027）

更新／只读核验日期：2026-10-16。本机开发库`form_system`（MySQL 8.4.11，127.0.0.1:3307）已应用迁移至`0027_remove_reviewfeedback`，没有待应用迁移。本页按当前0027结构维护；0027移除旧普通审核留言表review_feedback。

## 核验范围与计数

当前包含**26张业务模型表＋3张人员关联表，共29张业务表、230个实际字段**：业务模型表221列、人员关联表9列。全部实际表及列均与当前Django模型逐表核对，包括隐式主键、外键、UUID、JSON及存储生成列。共58条外键约束（60个外键列）：业务表之间36条，指向auth_user的22条。EMC的两条复合外键按约束计为2条、按列计为4列，避免混用数量。

本页不展开Django账号、组、权限、会话、迁移记录等系统表；图中每个指向auth_user的字段均标为FK并注明目标。核验只执行结构和迁移记录查询，没有执行迁移或修改业务数据，不代表其他设备也已升级。

## 完整字段与关系图

完整字段只在[Mermaid源文件](DATABASE-ER-FULL.mmd)维护。源文件包含全部230列、PK／FK／单列UK、实际SQL类型、可空性、生成列，以及业务表之间的普通和复合外键。联合唯一约束见下表。NOT NULL文字字段仍可能允许空字符串；`_unsigned`表示MySQL无符号类型。字段注释的ORM CASCADE／PROTECT为Django删除策略，不等同于MySQL外键直接配置了ON DELETE CASCADE。

图按ECR／ECO申请来源、轮次和行动、多人关联、填写交接及提醒、评估、物料和独立反馈分组理解；结构职责见[项目指南](../PROJECT_GUIDE.md#先理解业务数据组)。

## 0021之后的结构变化

| 迁移 | 变化 |
| --- | --- |
| 0022 | 多人行动负责人和多人批准；新增ecr_action_response_owners、eco_action_response_owners、change_request_stage_approvers三张关联表，个人审核增加approval_required；任务唯一键包含owner_id |
| 0023 | 新增eco_filler_event，保存ECO创建、历史基线和填写人交接事件 |
| 0024 | ChangeRequest默认stage改为ecr，不新增业务表 |
| 0025 | 新增eco_filler_inbox_read，按用户及填写人事件保存已读记录 |
| 0026 | review_round新增可空JSON字段form_snapshot；新提交冻结完整表单，旧轮不补造快照 |
| 0027 | 删除已停用且本机为空的review_feedback旧普通留言表（6列、2条外键），业务表总数30→29 |

0027删除review_feedback旧表，当前正式修改意见、独立系统反馈及其他业务表不变；旧普通留言接口与页面兼容已移除。

## 关键关系

- ECR与ECO均保存在change_request，通过source_ecr_id建立一对一来源关系；ECO只能关联一份来源ECR，同一ECR最多一个ECO。该外键保留PROTECT；整项删除由应用事务先删ECO再删ECR，不改变来源约束。
- review_round属于申请；action_task属于轮次，以轮次、行动键、负责人唯一；task_operation保存每人每次请求的操作回执。
- ecr_action_response_owners及eco_action_response_owners保存当前行动的负责人集合；change_request_stage_approvers保存当前指定批准人集合。review_record.approval_required标记冻结到具体轮次的批准职责，两者不能互相替代。
- eco_filler_event属于ECO，actor／previous_filler／filler关联账号；eco_filler_inbox_read按接收用户及事件保存已读状态。
- review_round.form_snapshot保存轮次正文，action_task、review_record和review_issue_event继续保存该轮各人的结果与处理证据。

## 实际表与字段数

| 表 | 字段数 | 类型 |
| --- | --- | --- |
| `change_request` | 28 | 业务模型表 |
| `eco_filler_event` | 9 | 业务模型表 |
| `eco_filler_inbox_read` | 3 | 业务模型表 |
| `review_round` | 16 | 业务模型表 |
| `review_record` | 7 | 业务模型表 |
| `action_task` | 9 | 业务模型表 |
| `task_operation` | 6 | 业务模型表 |
| `review_inbox_read` | 5 | 业务模型表 |
| `review_issue` | 10 | 业务模型表 |
| `review_issue_event` | 13 | 业务模型表 |
| `system_feedback` | 9 | 业务模型表 |
| `system_feedback_read` | 4 | 业务模型表 |
| `system_feedback_event` | 10 | 业务模型表 |
| `material_change` | 15 | 业务模型表 |
| `material_disposition` | 6 | 业务模型表 |
| `question_response` | 5 | 业务模型表 |
| `ecr_action_response` | 9 | 业务模型表 |
| `eco_action_response` | 9 | 业务模型表 |
| `execution_plan_response` | 7 | 业务模型表 |
| `significant_assessment` | 4 | 业务模型表 |
| `significant_chart_response` | 6 | 业务模型表 |
| `significant_question_response` | 5 | 业务模型表 |
| `emc_reference` | 8 | 业务模型表 |
| `emc_reference_row` | 5 | 业务模型表 |
| `emc_reference_test` | 7 | 业务模型表 |
| `emc_reference_cell` | 6 | 业务模型表 |
| `change_request_stage_approvers` | 3 | 人员关联表 |
| `ecr_action_response_owners` | 3 | 人员关联表 |
| `eco_action_response_owners` | 3 | 人员关联表 |

## 唯一约束（不含主键）

- `change_request`：`(eco_no_unique)`。
- `change_request`：`(ecr_no_unique)`。
- `change_request`：`(source_ecr_id)`。
- `eco_filler_event`：`(eco_id, request_id)`。
- `eco_filler_inbox_read`：`(user_id, event_id)`。
- `review_round`：`(change_id, number)`。
- `review_round`：`(change_id, request_id)`。
- `review_record`：`(round_id, reviewer_id)`。
- `action_task`：`(round_id, action_key, owner_id)`。
- `task_operation`：`(task_id, author_id, request_id)`。
- `review_inbox_read`：`(user_id, round_id)`。
- `review_issue_event`：`(change_id, author_id, request_id, position)`。
- `system_feedback`：`(submitter_id, request_id)`。
- `system_feedback_read`：`(user_id, feedback_id)`。
- `system_feedback_event`：`(feedback_id, request_id)`。
- `material_change`：`(change_id, request_id)`。
- `material_disposition`：`(material_id, location_item)`。
- `question_response`：`(change_id, number)`。
- `ecr_action_response`：`(change_id, action_key)`。
- `eco_action_response`：`(change_id, action_key)`。
- `execution_plan_response`：`(change_id, activity_key)`。
- `significant_assessment`：`(change_id)`。
- `significant_chart_response`：`(change_id, chart_key)`。
- `significant_question_response`：`(change_id, question_key)`。
- `emc_reference`：`(change_id)`。
- `emc_reference_row`：`(reference_id, id)`。
- `emc_reference_row`：`(reference_id, key)`。
- `emc_reference_test`：`(reference_id, id)`。
- `emc_reference_test`：`(reference_id, key)`。
- `emc_reference_cell`：`(row_id, test_id)`。
- `change_request_stage_approvers`：`(changerequest_id, user_id)`。
- `ecr_action_response_owners`：`(ecractionresponse_id, user_id)`。
- `eco_action_response_owners`：`(ecoactionresponse_id, user_id)`。

## EMC复合外键

`emc_reference_cell(reference_id,row_id)`关联`emc_reference_row(reference_id,id)`，`emc_reference_cell(reference_id,test_id)`关联`emc_reference_test(reference_id,id)`，约束填写格与行、列属于同一份参考。完整源文件单独显示这两条复合关系，同时保留普通外键。

状态、阶段、日期、版本及发布证据等检查约束以`backend/changes/models.py`及迁移文件为准；本页为结构说明，不替代业务规则[MVP](../MVP.md)。

## 历史图像

[0017 Mermaid快照](DATABASE-ER-0017.mmd)、[旧SVG](images/DATABASE-ER-FULL.svg)、[旧PNG](images/DATABASE-ER-FULL.png)仍保留当时23表／186字段结构，**不是当前0027图**；当前完整结构见本页及上述Mermaid源文件。旧日期验证记录继续表示当时的事实，不作为当前迁移终点。
