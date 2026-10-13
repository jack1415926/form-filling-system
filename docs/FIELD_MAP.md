# Excel 填报内容与开发对应关系

2026-10-13补充：旧自由结果填写、整单提交、公开审核和普通留言业务入口已删除；本机旧单流程申请已清理。当前权限与流程以[MVP](MVP.md)为准。

更新日期：2026-10-13。只维护源Excel坐标、字段／接口和模板疑点；当前状态见[README](../README.md)，规则见[MVP](MVP.md)，技术验证见[目录](testing/README.md)。

本轮恢复并核对的来源为 `reference/ECR-26010601-去除部分南京反应体物料号.xls`；此前旧机记录的文件名带 `(1)`。本轮重新只读核对概述单元格及十一张工作表名称，未运行宏、更新外部链接或保存原文件；复制及提取前后 SHA256 一致，不凭文件名推断与旧机文件内容完全相同。已填写的内容作为试填参考，不直接转换为每个新申请的默认值。

## 当前阶段接口与来源

stage-workflow／stage-submission／action-tasks／publication支持ECR和ECO，响应stage决定行动键及状态；ECO提交使用本单eco_no，轮次记录来源ecr_no。草稿／退回行动PATCH只允许owner_user_id／extra_required，结果由提交后本人任务接口保存；implementation_stage可保存但不能确认。

概述只读字段为stage／status、source_ecr_id／source_ecr_no／eco_creation_request_id和published_by_id／published_at／publication_request_id。ECO的ecr_no保持空，来源编号关联显示；非空ECR／ECO编号分别全局唯一。

| 接口 | 当前职责 |
| --- | --- |
| GET publications，兼容ecr-publications | 本人的指定发布列表；通用列表stage=all/ecr/eco，state=approved/published |
| GET／POST changes/{id}/publication | 查询能力／回执，指定发布人带request_id和expected_round执行发布 |
| POST changes/{id}/eco | 原发起人从已发布ECR创建；仅request_id，首次201、重复200返回已有ECO，不覆盖草稿 |
| GET changes/{id}/stage-navigation | 有权阶段摘要、编号、轮次、进度与can_open；无权相邻阶段隐藏数据 |
| GET changes/{eco_id}/source-ecr | 来源发布概述、编号及时间，不授予完整ECR历史访问 |
| GET changes/{eco_id}/ecr-actions | 来源问题及行动结果只读引用；PATCH拒绝 |

复制基础使用新主键和新物料／EMC外键，不复制旧新增UUID、任务、意见或行动结果。业务准入、发布和权限统一见[MVP](MVP.md)。消息按stage／eco_no显示，支持approved待发布；context及已读接口保持。

## 概述字段（已实现）

以下地址为“概述与物料处置”工作表中合并区域左上角。网页日期保存为 ISO 日期；原表 `2026.1.30` 手工试填为 `2026-01-30`。业务编号作为文本保留。

| 原表字段 | 源单元格 | 接口字段 |
| --- | --- | --- |
| 受影响产品和型号 | D3 | affected_products |
| 受影响区域 | D4 | affected_region |
| 发起变更的工厂（注册人） | D5 | initiating_factory |
| 受影响工厂 | D6 | affected_factories |
| ECR/ECO 标题 | D7 | title |
| ECR 编号 | D8 | ecr_no |
| ECO 编号 | H8 | eco_no |
| CCB 负责人 | D9 | ccb_owner |
| 设计负责人／变更发起人 | D10 | change_owner |
| ECO 计划完成时间 | D11 | planned_eco_date |
| 变更原因 | K3 | change_reason |

`applicant` 关联登录用户，与 D10 的业务负责人文字分开保存。`status`、`created_at`、`updated_at` 为系统字段。所有概述业务字段可暂不填写；短文本的长度和日期格式由后端检查。不自动编号；新阶段提交要求标题及本阶段编号非空，草稿允许留空。

编号规则见 [MVP](MVP.md#legacy兼容)；本文件维护映射，不另记录实现状态。当前状态见 [README](../README.md#当前进度)。

## 物料与处置映射（已实现）

### 三类物料明细

已只读核对“概述与物料处置”第 14、22、27 行表头；提取前后源文件 SHA256 一致，未运行宏或保存原表。网页序号仅按各组主键升序展示，不保存原 Excel 行号；新申请不预填样例（包括第 23 行的示例数字）。

| 原表列／字段 | 适用类别 | 接口字段 |
| --- | --- | --- |
| B：物料号或文件号 | 三类 | material_no |
| E：物料描述／文件标题 | 三类 | description |
| F：物料分类 | 三类 | material_class |
| G：维修备件 Y/N | 三类 | spare_part |
| H：选配件 Y/N | 三类 | optional_part |
| C：旧版本、D：新版本 | 升版 | old_revision、new_revision |
| I：变更描述 | 升版、停用 | change_description |
| C：版本 | 新增、停用 | revision |
| D：详细分类 | 新增 | detailed_class |
| D：在哪个项目停用？ | 停用 | discontinued_project |

`category` 新增时选择 `revision`／`addition`／`discontinuation`，保存后不可修改。所有业务文本可留空，短文本最多 255 字符，描述／变更描述为长文本；编号和版本不转换为数字，不新增物料号唯一规则。Y/N 字段保存 `""`／`"Y"`／`"N"`，空白与 N 区别处理。物料分类及详细分类为文字，不根据实例创造固定选项。

新增请求可携带只写 UUID `request_id`，当前网页在同一新增抽屉内保持该值以便失败重试。它不是业务编号，不在返回字段中，也不允许 PATCH；申请／UUID 组合唯一。相同内容重试返回原物料（200），首次新增返回 201；相同 UUID 携带不同内容返回 409 并保留输入，不覆盖既有数据。旧客户端不传 UUID 仍可新增，旧数据 UUID 为 NULL。

数据库为 `material_change`，通过 `change` 外键关联申请；申请归属由嵌套接口路径确定，客户端不能指定。列表读取、单条新增／PATCH／DELETE 与概述接口分开；读取按主键升序，编辑只提交修改字段，删除返回 204。接口拒绝未知、只读及不适用于该类别的字段。后续正式接入已包含 J:S 的十个位置处置，与基础物料一起保存。

### 物料处置表

原 ER 图已有 `material_disposition`，与 `material_change` 为一对多；当前 Model 和 `0005_materialdisposition` 已创建它。原图字段为 `id`、`material_id`（物料外键）、`location_group`（诺令库存／供应商库存／客户现场）、`location_item`（具体位置）、`disposition`（处置方式）和 `remark`（备注）。三组位置保存于同一处置表，每条物料／位置组合唯一；位置分组由后端按位置键确定。

原 Excel 升版区的 J14:S14 为合并总表头“物料处置建议”，下面是 J15／M15／Q15 三组，不是一个独立的自由文本建议栏。诺令库存含成品、在制品、原料；供应商库存含成品、在制品、原材料、RMA；客户现场含现场退货、在客户处、维修备件仓库。停用区也有同样的十个位置，新增加物料区没有这些处置列。处置方式使用源表辅助列中的 Use-up、Scrap、Rework、No Change、Balance、NA，另允许未填写；不自动填值，不新增分类适用的自动判断规则，业务适用性仍需人工确认。

物料接口请求／返回增加 `dispositions` 对象：以 `company_finished` 等十个位置键为索引，值包含 `disposition` 和 `remark`。PATCH 只更新提交的格，省略的位置或格不改变；显式空字符串用于清空，处置和备注均为空时删除该位置记录，读取时由页面显示未填写。新增类别拒绝处置字段。保存沿用申请行锁和事务，基础物料与处置一并提交；新增 UUID 重试同时比较处置内容，变化则返回 409。

2026-10-03 原 `.xls` 只读补核：J17:S19、J28:S61 的数据验证均引用 T12:T17 六种处置，允许空白；新增区不在其覆盖范围。F14 注释为“物料原先的分类”，说明升版分类含义，不构成处置方式限制。两张目标表未发现额外的处置组合限制；业务适用性不由模板选项自动判断。提取方式与边界见 [源表补核](testing/AUTOSAVE-BUSINESS-REVIEW-2026-10-03.md#后续源表只读补核2026-10-03)。

正式页面的数据请求及退出请求携带 `X-Expected-User`（页面预期账号 ID）。后端仍以当前认证账号决定权限；该头仅作上下文前提校验，不授予任何权限。与当前账号不符时返回 409、`code=account_changed`，操作不执行，页面刷新身份并切换工作台。旧 API 客户端未携带此头时保持既有认证行为；登录、身份读取及 CSRF 获取不绑定旧账号。物料列表 GET 在同一事务内锁定申请并完成基础字段及处置读取，避免混合不同版本。

## 八表总览与开发映射

| 工作表 | 填报或展示内容 |
| --- | --- |
| 概述与物料处置 | 概述，以及升版、新增、停用物料；库存与客户现场等各位置的处置 |
| 问题 | 27 个问题的回答和备注，固定问题文字及职能 |
| ECR | 固定评估行动、负责人、评估结果、完成／不适用状态及日期 |
| ECO | 固定行动、负责人、完成情况、完成／不适用／在实施阶段完成状态及日期 |
| EMC reference | 参考定义只读；本人申请填写测试标记与说明，已正式接入B版；有权处理人员按具体申请当前轮次权限只读审查，管理员定义维护暂不纳入 MVP |
| 设计变更执行计划 | 已接入；11 条固定活动、责任人、开始与结束日期及备注 |
| 实质性变更评估表 | 已接入；七项主表适用性、原因、原规则下一步提示、人工组结论与最终结论 |
| 实质性变更评估子表 | 已接入A～E抽屉；37题回答、原因及原规则提示 |

总体实施安排见 [MVP](MVP.md)，当前下一小批入口见 README；本文件只维护字段与规则映射。

八张工作表不对应八张数据库表。物料与位置处置、问题与行动定义、回答及规则分别按原技术方案建模。

### “问题”表（已实现，待业务复核）

源表 A 列为职能分组（合并区域需要按原组归属读取）、B 列为题号、C 列为评估回答、D 列为固定题目、E 列为备注；题目位于第 3—29 行，共 27 题。网页需保留完整题干，区分未回答／是／否，新申请不复制源实例的回答。

本批逐题核对题号、题干和职能，与原表一致；原文件 SHA256 未变。七组为法规 1—4、风险 5、研发 6—16、生产 17—20、EHS 21、售后 22—25、QA 26—27。固定题目和提示由后端 `questions.py` 维护，客户端从接口读取。

第 5 题要求回答否时说明风险理由；第 13 题要求不影响 DHF 充分性／适宜性时说明理由；第 14 题要求不需要设计验证时备注理由。已确认这三题选否且备注为空时仅提示，不阻断草稿保存；草稿保存允许未回答，当前ECR／ECO提交须完成全部27题回答。第 13 题保留完整复合题干和一个综合回答格，不拆分；不同判断的细节填在备注。不能仅从实例空备注判断这些规则已经满足。

`question_response` 保存申请、题号、回答和备注；同申请／题号唯一，回答为 `""`／`"Y"`／`"N"`。回答及备注都为空时删除该题记录，GET 仍返回完整 27 题。`/api/changes/{id}/questions/` 的 GET／PATCH 返回 `{updated_at, questions}`，每项含 `number`、`function`、`text`、`remark_hint`、`answer`、`remark`。提示为 null 或 `{answer, text}`。

PATCH 接受 `{"responses":{"5":{"answer":"N","remark":"理由"}}}`，题号键只接受 `"1"`—`"27"`，省略格保持原值，空字符串清空；不接受 null、未知字段或客户端改题干。空 responses、空单题及与当前值相同的请求不改更新时间。全部输入先校验，回答及申请更新时间在申请行锁事务中保存；权限、预期账号、CSRF 及非草稿只读沿用现有保护。交付边界见 [项目开发梳理](FIELD_MAP.md)。

### ECR／ECO源字段与当前任务填写接口

当前ECR／ECO在draft／returned的行动PATCH仅分配负责人（owner_user_id或多人owner_user_ids）及extra_required补充标记；提交后每人通过自己的任务接口填写并确认result／status／date。旧owner文字只作字段来源，不自动匹配账号；提交时所选负责人必须有效，不能以关联账号代替任务确认。

ECR 已正式接入：固定定义存于 `backend/changes/ecr_actions.json`，61 条完整行动与源 ECR!A3:C63 及主清单一致，独立标识 ecr_001—ecr_061 与来源问题号分开。正式后端使用该配置；数据库 `ecr_action_response` 保存所属申请、行动标识、owner、owner_user外键、extra_required、result、status、date。

GET `/api/changes/{id}/ecr-actions/` 返回 `{updated_at, actions}`，每项含 id、number、function、text、question_answer、owner、owner_user_id、owner_user、result、status、date。question_answer 从已保存问题回答计算，不由客户端填写；默认未回答、文字为空、日期 null。按用户最新选择，页面默认只显示来源问题为是的行动；否或未回答时隐藏，已有填写保留，再次触发时恢复显示。全部列表可查看未触发行动；通过extra_required明确补充。不自动把否解释为不适用。

ECR的draft／returned行动PATCH仅owner_user_id／owner_user_ids／extra_required；提交后负责人通过action-tasks填写result／status／date并确认。原owner是最多255字的只读姓名，结果多行文本，状态空／completed／not_applicable，日期ISO或null。局部省略不变，显式空值清空，重复原UUID确认原请求；归属、阶段、版本和账号校验以阶段接口为准。

ECO 固定定义存于 `backend/changes/eco_actions.json`，61 条行动逐项对应 ECO!A3:C63 和主清单 G:I，标识 eco_001—eco_061。D:G 为 owner（负责人）、result（行动完成情况）、status（状态）、date（日期）；完成情况提示保留“需要注明变动文件编号、ECO相对ECR变化点等”。数据库 `eco_action_response` 保存申请、稳定行动标识、原owner文字、owner_user外键、extra_required及result／status／date，同申请／行动唯一、合法行动及状态 CHECK，删除申请级联。

GET `/api/changes/{id}/eco-actions/`返回独立ECO行动。ECO草稿／退回PATCH仅负责人／补充标记，结果走任务接口；省略保持、显式空值清空。ECO status 允许空／completed／not_applicable／implementation_stage，对应未填写／完成／不适用／在实施阶段完成，字段长度24。原负责人文字只读且最多255，负责人通过owner_user_id关联账号，完成情况为多行文本，日期为 ISO 或 null。问题回答为只读计算值，不接受客户端改写定义或映射。

新ECO只能从已发布ECR创建，行动范围按ECO本单问题及补充标记确定，负责人确认不适用须原因；implementation_stage不能确认。ECO本单问题与行动结果独立，来源ECR发布结果只读引用，包含多人逐人确认结果。新申请原文字／结果／状态为空，账号关联和日期为null；本机源表 ECO!D3:G63 全空，因此 #8 不创建样例记录。源文件和 ECR／ECO／主清单逐项核对见 [本轮记录](testing/ECR-ECO-2026-10-02.md)。

新阶段提交根据当前纳入负责人派发冻结任务，原意见提出者按轮保留复核职责；单纯草稿关联不授予正文权限。负责人、批准人和发布人分别指定；旧姓名不自动匹配账号。执行计划保持固定活动及填写结果分离；F 主子表保留题目标识、适用性、回答、原因、下一步和结论的对应关系。

## 设计变更执行计划（已实现）

源表 A3:E3 为活动、责任人、开始时间、结束时间、备注；A4:A14 的 11 条活动逐项对应 plan_001—plan_011，包括“里程碑 9”。活动只读，不增删排序或按问题联动；B:D 的样例责任人与空日期不预填，新申请及 #8 只显示空白填写。日期用 ISO 日期／NULL，责任人文字最多255字符，备注多行文本。

源表日期验证只有输入提示，没有顺序限制。本批按用户确认新增：两端填写时结束日期不得早于开始日期，前端／接口／数据库一致；同日、单端日期及空白允许。任何一行非法整批不写入，活动不自动执行注册或发布动作。

GET／PATCH `/api/changes/{id}/execution-plan/` 返回 `{updated_at, rows}`，PATCH 接受 `{responses: {plan_001: {owner, start_date, end_date, remark}}}`；省略保持，文字空串／日期NULL清空。全空删除填写行，固定活动保留；读和空请求不写入。详情见 [本批记录](testing/EXECUTION-PLAN-2026-10-03.md)。

## 隐藏辅助表与规则来源

- “主清单”：问题与 ECR/ECO 行动的对应关系，一个问题可能关联多个行动；提取时保留对应关系，不按问题编号去重而丢失行动。
- “Decision Tree Refer ”：保留原有指导内容，不将其自动转为本次新增的审批、拒绝或退回流程。
- “实质性变更主清单”：子问题的 Y/N 分支、下一题和结束结论，作为固定规则来源。

新增或调整规则前需逐项登记完整字段、固定项标识和规则分支，尤其核对条件性备注、主子表跳转及结束条件。原实例中的回答与行动填写内容分别保留，不因问题回答“否”而自动删除已填行动。旧表中的宏、隐藏区域和公式用于技术核对，不构成 MVP 的 Excel 导入／导出功能。

## EMC reference：B版交叉格填写

原表介绍／图例／定义、12类典型变更及11个测试列保留，三层表头显示抗干扰性7列和发射4列，IEC 1000-3／CISPR11各跨2列。填写格mark为`""`／`"X"`／`"(X)"`，remark为多行说明；空白不是无需测试。用户选择B版后以本次范围替代原只读方案，暂不接入定义维护。

GET/PATCH `/api/changes/{id}/emc/` 返回矩阵、updated_at、initialized和can_fill。PATCH结构为 `{"cells":{"emc_change_001/emc_test_001":{"mark":"X","remark":"说明"}}}`；省略保持、空字符串清空。只允许本人申请，metadata、行列、角色等字段拒绝；超级用户也不开放跨申请维护。

四张表为emc_reference、emc_reference_row、emc_reference_test、emc_reference_cell。稳定行／列键与物理主键分开，交叉格通过行和测试外键关联，同格唯一及复合归属约束。GET返回默认配置但不写库，首次实际填写保存本单副本；空格不创建记录，清空两格删除记录但保留参考。旧申请未补录EMC结果，问题7改变不删除填写。来源与限制见[接入记录](testing/EMC-INTEGRATION-2026-10-03.md)。

## 实质性变更评估主表／子表（已实现）

主表C2／C3／C4引用概述D8／D7／K3，网页直接显示已保存ECR编号／标题／变更原因。B6:F11为第0项及A～E，C列映射applicability（空／Y适用／N不适用），D列reason，E列原公式next_steps只读提示；A～E的F列为人工result，第0项无子表结论。A～Dresult为空／not_applicable／significant／continue，E最后一项为non_significant。F项C12映射f_assessment（空／not_applicable／ra_non_significant／ra_significant），C14最终结论为空／non_significant／significant，标签保留原数据验证文本，不预填实例。

子表B3:F39与隐藏主清单C3:J39逐题对应：题号、完整题干、Y/N回答、只读分支结果、原因。A4题、B10题、C8题、D6题、E9题，共37题。内部question_key如sub_b_1_1，页面显示B-1.1；answer为空／Y／N，reason为原F列。原子表E40汇总结论在网页改为各组抽屉底部人工选择，直接编辑主表该组result，没有第二份结论记录。

固定定义在backend/changes/significant_change.json，来源地址、原主表公式、验证说明及原分组标题随定义保留；GET/PATCH `/api/changes/{id}/significant-change/` 返回完整定义和updated_at。PATCH格式为 `{"assessment":{"final_conclusion":"significant"},"charts":{"A":{"applicability":"Y","result":"continue"}},"questions":{"sub_b_1_1":{"answer":"N","reason":"原因"}}}`；省略保持、空字符串清空，未知字段、非法标识或选项整批拒绝，全部字段空白删除对应填写记录。GET不创建数据，固定文字不随申请复制。

主表B不适用提前结束提示、多行说明重复引用Chart B、C-2原分组标题及第0项参考清单缺失均标注疑点，不自动改分支或结论；未回答不等于N，不适用不删除回答，改答不清除人工结论。源文件哈希、74个分支及验证定义比对见 [交付记录](testing/SIGNIFICANT-CHANGE-2026-10-04.md)。

## 当前阶段提交与轮次（系统新增）

stage、review_mode、submitted_at及current_review_round为系统字段，不对应原Excel单元格。ECR／ECO通过stage-submission提交，冻结行动任务、负责人和指定批准人；至少一位有效批准人，零任务明确确认后仍须逐人同意，再由指定发布人显式发布。旧submission整单入口及公开审核已删除。

review_round冻结本轮标题、编号、时间和终态；action_task保存逐人行动结果／确认，review_record保存参与关系及approval_required／approved_at，意见事件记录回应与原提出者复核。修订重提产生新轮，旧确认与旧批准不计入当前进度；基础表没有完整逐轮快照。详细权限以[MVP](MVP.md)为准。

## 正式审核修改意见（0014，已实现）

独立系统反馈（0015）使用system_feedback及system_feedback_event，不属于Excel字段，不关联申请或审核轮次；反馈类型、文字、状态、公开处理记录及UUID／版本为系统新增字段。review_feedback仅保留历史表结构，旧单流程留言已随申请清理。0016另新增review_inbox_read，保存用户、轮次、消息批签名及已读时间，按用户／轮次唯一；不属于Excel字段，也不改变业务待办。当前字段与类型以models.py及迁移为准；[数据库ER图](design/DATABASE-ER-FULL.md)是0021历史快照。

系统新增内容，不属于Excel原字段。每条意见保存所属网页页签、可选题号／行动号／物料文字定位、具体问题、原提出者和来源轮次；定位不绑定可被删除的物料记录。review_issue保存状态和版本，review_issue_event追加回应、确认解决及继续修改过程。未解决项跨轮保留，重提冻结当前行动分配与批准人，原提出者确认解决后才允许正常批准。旧单流程普通留言业务已停用；独立系统反馈已由0015批次接入，与正式审核意见分别保存。[审核意见交付与验证](testing/REVIEW-ISSUES-2026-10-05.md)。

## 系统反馈追加与提醒（0017）

SystemFeedbackEvent新增kind区分manager／followup，历史事件默认manager；用户追加只允许本人，原文只读，关闭后追加转为processing。system_feedback_read保存user_id、feedback_id和入站消息version，用户／反馈唯一。追加和管理员处理共用反馈行锁、UUID及预期版本；已读同样锁反馈并核对入站快照。系统反馈不是Excel字段，不修改申请状态。

## 当前阶段任务接口（0019～0024）

stage只读，新建为ecr，eco只能从已发布ECR创建。publisher_id指定本单发布人，stage_approver_ids指定批准人；草稿／退回行动PATCH仅负责人集合及extra_required。result／status／date由冻结轮次中各负责人通过任务接口填写和确认；ECOimplementation_stage只能保存，不能确认。0024仅改变模型默认阶段，不新增表。

任务快照绑定轮次及稳定行动标识，version和请求回执保护保存／确认；本轮确认不复用旧轮确认。阶段数据含actor_id、change_id、current_round、actions、tasks、unanswered、issue_blockers和submission_requests，完整响应经校验后更新缓存。修订期间其他参与者只取得授权任务／意见历史，change为null、actions为空，不泄露正在修订的正文。新接口路径、载荷及验证见[第一批记录](testing/ECR-STAGE-2026-10-12.md)。旧自由填写和整单提交入口不再提供。

## 五项审查修复与接口行为

载荷及路径未新增：任务保存重试先确认原UUID，若仍有后续输入则以新版本／新UUID写入；任务状态或版本再次变化时保留输入并提示核对。GET阶段数据在完整性校验后按updated_at合并，迟到响应不覆盖较新缓存。确认优先查原回执；无回执且任务结束／版本变化时释放不可执行原确认，未发送输入保留。

工作台合并任务与意见dirty／busy，但不使用自身busy禁用查询／重试。本人在returned提出并回应意见时沿用单条发起人消息及原已读签名，不再返回重复申请ID。最新验证见[五项修复记录](testing/ECR-REVIEW-FIXES-2026-10-12.md)。
