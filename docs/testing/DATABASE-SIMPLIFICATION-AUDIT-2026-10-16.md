# 数据库表必要性与历史遗留审查

后续处理：用户已授权删除review_feedback，现已通过0027完成；当前为29张业务表。下文保留删除前0026的审查证据及当时建议，执行结果见[旧普通留言表移除记录](REVIEW-FEEDBACK-REMOVAL-2026-10-16.md)。

日期：2026-10-16。范围：当前0026的27张业务模型表及3张人员关联表。方法：模型／迁移、当前URL和前后端读写路径静态核对，加本机form_system只读行数及兼容字段统计；不执行迁移、删除或业务写入，也不运行全量测试。这里的行数为本次查询快照，不单独作为删除依据。机器原始核对结果保存在被Git忽略的`.local/database-usage-audit-20261016.json`。

## 结论

**发现1张业务写入已经停用、只剩历史读取兼容的表：review_feedback。** 本机0行，没有发现当前业务新增写入路径，旧留言POST分支明确返回409；审核页仍每次查询它，前端保留历史留言展示。它是第一优先级的删除候选，清理后表数可从30降至29。尚未实施删除；其他设备是否仍有需要保留的旧留言未核验。

其余29张表均找到现行业务用途或多人关联用途，没有发现可以仅凭当前证据直接删除的第二张表。存在两组旧人员兼容字段及一些摘要／历史重复存储，但应区别处理，不应把它们算成无用表。

## 按优先级排列的精简建议

### 1. 建议列入清理：旧普通审核留言表review_feedback

- 模型：`backend/changes/models.py:171`；本机0行，6个字段。
- 读取：`backend/changes/review_views.py:50`仍查询该表并输出feedback；`frontend/src/ReviewPanel.tsx`仍展示“历史留言，只读”，`frontend/src/review.ts`仍要求反馈数组和can_feedback字段。
- 写入：`ReviewDetail.post`的feedback分支在读取输入前直接返回409“普通留言已停止新增”；当前业务源码未发现ReviewFeedback创建路径。整项删除专项会人为创建该记录以测试级联，那是测试夹具，不是生产写入入口。Django后台未注册该模型。
- 替代职责：当前正式修改意见及其回应／复核分别由review_issue、review_issue_event负责；独立系统反馈由system_feedback系列负责。此处不是要合并这两种现行业务，而是移除已停用的普通留言。
- 实施范围：通过新迁移移除模型及表，同步去掉历史读取、UI／类型兼容、未引用的TextValues旧输入类，以及仅为该表保留的测试夹具和文档说明。已有迁移历史保留，不重写0001～0026。实施前核对其他设备旧留言的保留要求；不要只删除表却留下审核详情查询。

### 2. 可进一步精简字段：两类行动表的旧人员表示

`ecr_action_response`和`eco_action_response`分别同时保留owner文字、owner_user单人外键、owners多人关联。当前多人字段是正式选择入口；`serializers.py:127–146`仍将单人输入转换为集合，或把集合第一人写回owner_user，`stage_workflow.py:63–64`还保留旧单人回退。这些是实际兼容／双写路径，并非已经无引用的字段。

| 本机指标 | ECR行动表 | ECO行动表 |
| --- | ---: | ---: |
| 行动记录 | 39 | 14 |
| 非空旧owner文字 | 0 | 0 |
| 非空owner_user外键 | 39 | 14 |
| 必须依靠单人外键回退、多人集合为空的记录 | 0 | 0 |
| 真正多人分配的行动记录 | 0 | 1 |

结论：旧owner文字两列是较好的字段清理候选；owner_user两列也可评估改为从多人集合派生，但需同步旧API、来源ECR展示、初始任务构造、样例和历史兼容。旧外键当前带PROTECT，移除后还要核对账号删除保护是否仍符合现有规则。此类清理不减少业务表数量，不建议与第一张表的删除捆绑实施。

### 3. 看似重复但职责不同，建议保留

| 组合 | 实际区别与保留原因 |
| --- | --- |
| ecr_action_response／eco_action_response 与 action_task | 前者保存当前行动分配、补充标记及部分摘要；后者保存每一轮、每个行动、每个负责人的结果和确认。单人任务保存时会同步一份结果摘要（stage_workflow.py:206），但多人结果不能由一个摘要替代。可后续审查摘要列，不能因此删除任务或分配表 |
| 当前stage_approvers关联 与 review_record | 前者是当前可调整的批准人集合；后者冻结具体轮次的参与人及批准职责／时间。回退、改派后仍需旧轮证据和权限，不能直接合并 |
| action_task 与 task_operation | 当前任务状态和每次请求的回执不同；现有代码用后者核验同UUID是否为同一操作并恢复未知结果。不是无意义的第二份任务表 |
| review_issue 与 review_issue_event | 一张存当前问题及处理状态，一张存提出、回应、复核和批准等过程／请求证据 |
| 当前表单 与 review_round.form_snapshot | 一个可修订，一个保存提交时正文和定义；用于旧轮历史查看。去掉快照会重新出现历史读取当前修订内容的问题 |
| review_inbox_read／eco_filler_inbox_read／system_feedback_read | 分别对应审核轮次签名、ECO人员事件和独立反馈入站版本，失效和已读规则不同。统一成通用消息表需要重新设计，当前没有证据表明值得为减少表数而重做 |
| EMC四张表 | 分别保存本单参考元数据、变更行、测试列和填写格。每单行列副本用于发布冻结、ECO独立复制；重复的模板内容有版本隔离目的，改成共享可变定义会影响旧记录 |
| ECR／ECO两张行动表及两张负责人关联表 | 字段结构相似，但行动定义、允许状态及来源只读规则不同。技术上可用统一行动表减少两张表，但涉及旧主键／人员关系迁移、状态约束、API和历史回归，当前收益不足以优先实施 |

### 4. 空表但仍在使用，不建议删除

- `significant_question_response`本机0行；`significant_change_views.py`仍提供子题读取和保存，`publication.copy_base`仍复制到独立ECO。当前未填子题不等于功能停用。
- `emc_reference_cell`本机0行；`emc_views.persist`仍按交叉格选择和备注创建、更新、清空记录；EMC参考及行列当前有实际数据。没有选择测试格不等于格表无用途。

### 5. 更小的历史分支可另行整理，不作为删表依据

本机legacy申请0条，11个轮次全部designated；33条review_record全部assigned=True。代码和约束仍保留legacy／public／assigned的旧表达。这说明有历史分支可进一步整理，但assigned和review_mode仍参与授权过滤，不能因本机取值单一就直接删除。旧迁移继续解释已有数据结构，不以删除迁移文件替代新迁移。

## 全部30张表的核对清单

| 表 | 本机行数 | 当前用途及判断 |
| --- | ---: | --- |
| change_request | 18 | 申请、阶段、来源、编号、发布；保留 |
| eco_filler_event | 5 | 创建／交接事件、历史及回执；保留 |
| eco_filler_inbox_read | 1 | 接收人提醒已读；保留 |
| review_round | 11 | 轮次状态、冻结正文；保留 |
| review_record | 33 | 轮次参与与逐人批准；保留 |
| action_task | 66 | 按轮、行动、负责人独立任务；保留 |
| task_operation | 142 | 保存／确认请求回执；保留 |
| review_feedback | 0 | 只剩旧普通留言读取兼容；优先清理候选 |
| review_inbox_read | 1 | 审核消息签名已读；保留 |
| review_issue | 2 | 正式修改意见当前状态；保留 |
| review_issue_event | 13 | 意见及审核过程证据；保留 |
| system_feedback | 3 | 独立反馈原文与当前状态；保留 |
| system_feedback_read | 4 | 独立反馈入站版本已读；保留 |
| system_feedback_event | 7 | 管理员回复／用户追加及状态变化；保留 |
| material_change | 4 | 物料三类变更；保留 |
| material_disposition | 10 | 各位置处置；保留 |
| question_response | 324 | 27题答案与说明；保留 |
| ecr_action_response | 39 | 当前ECR行动分配及摘要；保留，人员兼容字段待精简 |
| eco_action_response | 14 | 当前ECO行动分配及摘要；保留，人员兼容字段待精简 |
| execution_plan_response | 1 | 计划负责人、日期、说明；保留 |
| significant_assessment | 1 | 人工实质性总论；保留 |
| significant_chart_response | 8 | Chart适用性、理由、组结论；保留 |
| significant_question_response | 0 | 仍有读写及复制路径的评估子题；保留 |
| emc_reference | 11 | 本单参考定义；保留 |
| emc_reference_row | 132 | 本单参考变更行；保留 |
| emc_reference_test | 121 | 本单参考测试列；保留 |
| emc_reference_cell | 0 | 仍有读写路径的交叉格；保留 |
| change_request_stage_approvers | 7 | 当前多人批准集合；保留 |
| ecr_action_response_owners | 39 | 当前ECR行动多人负责人；保留 |
| eco_action_response_owners | 15 | 当前ECO行动多人负责人；保留 |

## 建议实施顺序与边界

先单独处理review_feedback及其历史留言兼容路径，目标30→29张；然后再评估旧owner／owner_user字段，保持多人和历史能力。其余表本轮不建议为减数而合并。若后续授权结构清理，将需要0026之后的新迁移；**本次没有生成0027，也没有删除任何表、字段或数据**。

静态读写追踪不等于全量业务测试，当前行数不代表其他设备或未来使用情况；未核验外部系统／人工SQL是否使用旧表，也未对精简后的系统作性能收益承诺。
