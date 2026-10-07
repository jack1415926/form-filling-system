# 开发与演示

更新日期：2026-10-07。本文维护已有项目的日常操作、代码更新、检查和历史迁移参考。首次在Windows新设备安装、建库、配置账号并走完整业务流程，按[新设备上手指南](GETTING_STARTED.md)顺序执行。

| 要做什么 | 入口 |
| --- | --- |
| 首次在另一台设备运行 | [新设备上手](GETTING_STARTED.md)第1～8步 |
| 日常启动／停止 | [上手指南第9步](GETTING_STARTED.md#9-以后如何启动和停止)或下文启动章节 |
| 更新已有代码与数据库 | 下文“同步与迁移” |
| 修改代码后检查 | 下文“开发检查” |
| 查询某次交付或迁移证据 | 下文历史参考及[testing目录](testing/) |

进度和Git状态以[README](../README.md)为汇总入口；需求以[MVP](MVP.md)为准；代码地图见[开发梳理](PROJECT_GUIDE.md)；字段来源见[字段映射](FIELD_MAP.md)。

## 环境与配置

项目基线为Node.js 24、Python 3.14、MySQL 8.4及PowerShell 7。配置结构、空数据库创建及依赖安装统一见[上手指南](GETTING_STARTED.md#1-准备软件与项目目录)。本机曾使用F:\codex_project\form_file_system，新设备自行选择路径并重建虚拟环境，不复制旧设备的绝对路径。

后端脚本读取`.local/development.json`，已有同名进程环境变量优先。默认后端8000；旧设备因占用使用8001，同时配置`frontend/.env.local`的BACKEND_PORT。两边须一致，修改后重启；前端固定localhost:5173。凭据、数据库、原Excel和本机配置不随Git同步。

### 改名后修复虚拟环境

这是旧设备移动项目后的历史修复方法，新设备优先按上手指南重新建立环境。在新项目根目录执行，沿用[上手指南](GETTING_STARTED.md#3-安装项目依赖)的uv缓存设置；解释器路径以实际安装为准。若沙箱拒绝访问现有缓存，在普通用户 PowerShell 中执行，不修改缓存 ACL。

```powershell
uv venv --allow-existing --python .local\python\cpython-3.14.6-windows-x86_64-none\python.exe .venv
uv pip install --offline --reinstall --python .venv\Scripts\python.exe -r backend\requirements.txt
```

这会重新生成启动器并按原锁定版本重装依赖，保留 `.local` 配置和数据库。修复后执行下方 Django 检查，再用后端脚本的 `showmigrations changes` 确认迁移状态。

## 启动与账号

确认MySQL运行，项目根目录启动后端：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1
```

另开PowerShell，进入同一项目的`frontend`目录执行`npm.cmd run dev`，访问[正式网页](http://localhost:5173)。两窗口保持打开，停止前确认保存成功且无未知操作，再分别Ctrl+C；不会自动停止MySQL。`-ExecutionPolicy Bypass`仅用于该进程。新设备无旧演示账号，须自行创建。

### 提交批次升级与审核账号配置

技术管理员通过后端脚本的`createsuperuser`建立，再在后端`/admin/`创建启用的普通填写员及至少两名审核员。审核员加入原生“审核员”组，不需staff／superuser；技术超级用户不会自动成为审核员。具体步骤及账号示例见[上手指南第7步](GETTING_STARTED.md#7-配置业务账号)。

旧设备的填报／管理员凭据曾保存在`.local/demo-accounts.json`，保留审核员凭据在`.local/reviewer-accounts.json`；仅供该设备，不复制到新设备或Git。旧样例#8不随代码同步。单账号新登录会使旧会话失效；完整多身份操作按[第8步](GETTING_STARTED.md#8-走完整业务流程)使用独立浏览器或配置文件。

## 同步与迁移

当前完整升级目标为`0014_review_issues`；Git记录见[README当前进度](../README.md#当前进度)，不要以旧本地main或旧提交代替最新代码。

1. 保留本机配置和未提交修改；确认项目数据库范围，备份已有开发库，停止本项目后端写入。
2. 获取所需源码版本。Git拉取不复制数据库、账号或申请，也不执行迁移。
3. 若依赖锁定文件变化，按上手指南重新安装对应依赖；保留自己的`.local`和前端本机配置。
4. 根目录执行下列迁移和检查，确认0014及此前全部标为[X]。不能只迁移到某模块最初交付的0011／0012／0013。
5. 重启当前源码的前后端，关闭旧页面并重新加载，核对登录、已有申请读取及基本操作。使用`--noreload`的旧后端不会自动加载新代码，必须重启。

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 migrate --noinput
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 showmigrations changes
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
```

### 正式审核意见升级（0014）

前后端须同步升级：批准POST必填request_id；退回改为request_id加非空issues清单，新增respond／resolve；旧空批准、仅文字退回及普通feedback写入不再支持。旧留言与退回原因只读保留，不删除或追认为已解决意见；升级前无正式意见的退回申请仍可重提。

存在未解决项时须全部回应并沿用原审核安排；全部意见由原提出者确认解决后，才能正常批准。0014若已有意见或请求确认事件，逆迁移明确拒绝，须另定历史保留方案。0013也有审核历史保护，不能将回退迁移当作撤销审核。详见[正式意见交付](testing/REVIEW-ISSUES-2026-10-05.md)与[历史审核交付](testing/REVIEW-WORKFLOW-2026-10-05.md)。

## 开发检查

普通启动只需上手指南中的Django check和迁移检查；以下是修改代码或交付时的检查命令，不要求每天演示前全部执行。

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 makemigrations --check --dry-run
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 test changes --noinput
cd frontend
npm.cmd run lint
npm.cmd run test:api
npm.cmd run test:form-draft
npm.cmd run test:autosave
npm.cmd run test:execution-plan
npm.cmd run test:significant-change
npm.cmd run test:submission
npm.cmd run test:review
npm.cmd run test:questions
npm.cmd run test:ecr-preview
npm.cmd run test:ecr-draft
npm.cmd run test:eco-draft
npm.cmd run test:latest-response
npm.cmd run test:emc-draft
node --test tests/*.test.mjs
npm.cmd run build
```

完整前端检查使用`node --test tests/*.test.mjs`，覆盖未注册到npm脚本的material-save检查。

后端测试使用真实 MySQL 独立库 `test_form_system`，结束后销毁。`DB_TEST_NAME` 可覆盖测试库名，但不得与开发库同名（忽略大小写）；不使用 SQLite 替代。测试账号还须具备该独立测试库的创建／删除及读写权限，第2步上手配置只授予开发库权限；不要为运行测试将开发库用作测试库。测试结果不能代替新设备验证或用户业务验收。

### 按修改范围运行测试

后端局部检查可把上述 `test changes` 改为 `test changes.test_materials`、`test changes.test_questions` 或具体的 `模块.类.测试方法`；查看耗时用 `test changes --noinput --durations 10 --timing`。普通功能测试的快速哈希器只在测试类生效，不修改生产密码配置。

布局／文案改动主要运行前端 lint/build；接口、权限、事务和迁移改动运行受影响后端测试，一批交付或合并前再运行全量。保留独立 MySQL 库、CSRF 和权限检查，不以减少测试数量为目标。计时基准见 [测试精简记录](testing/TEST-SIMPLIFICATION-2026-10-02.md)。

问题页保存状态修改还需运行 `test:questions`，使用 Node 原生测试检查局部 PATCH、结果未确认时恢复原值和失败分类；刷新／关闭与实际组件的重试流程另做浏览器回归，不能用这些纯逻辑测试代替。

概述／问题／EMC／执行计划／实质性评估页有未保存内容时切换页签，可选择“继续填写”“放弃修改并切换”或“保存并切换”；第三项复用当前页的校验及保存，成功才切页，失败留在原页。问题页顶部也可直接保存，无需滚到最底部。八页自动保存现已启用，范围、2 秒停顿、失败重试与首次物料手动创建见 [README](../README.md#待办)；刷新／关闭仍保留未保存保护，不具备本地异常退出恢复。

ECR 内存演示仍可访问 `http://localhost:5173/?preview=ecr`，不需要登录、MySQL 或后端，刷新恢复初始场景。正式填写请使用无查询参数的网站入口并登录，进入申请的 ECR 评估或 ECO 执行页签。`test:ecr-preview` 检查共用固定行动、演示联动及单条保存逻辑；正式接口验证见 [接入记录](testing/ECR-INTEGRATION-2026-10-02.md)。

## 历史迁移与模块参考

以下保留各批独有的迁移、数据保护、样例和验证信息；“本机已应用”、运行状态及测试数量均为当时记录，不代表另一台设备已具备环境或数据。当前升级统一按上文执行至0014，当前行为以README和MVP为准。其他逐批证据见[testing目录](testing/)。

### 基础表及八表迁移（0002～0010）

`0002_unique_numbers` 先按数据库排序规则检查重复非空编号，冲突时在 DDL 前停止并列出编号和申请 ID。由业务确认修正后重试，不自动删数据或改号。迁移回退只移除生成列和约束，申请数据保留，但唯一性保护也会失效。迁移完成后运行下列检查，再启动服务。

`0003_materialchange` 只新增三类物料表、申请外键及类别／Y/N 检查约束，不修改或预填已有申请。本机已应用；其他设备仍须执行迁移。后端若以 `--noreload` 运行，代码更新后必须重启，否则旧进程不会加载新增路由。

`0004_materialchange_request_id_and_more` 新增可空 UUID `request_id` 及申请／UUID 组合唯一约束，旧物料的 UUID 为 NULL，业务字段保留。本机已应用；更新前端去重逻辑前须先部署迁移及后端，再更新前端。

`0005_materialdisposition` 新增处置表、物料外键、位置唯一约束及位置／处置值 CHECK；原申请和物料字段不改，不预填 NA。先执行迁移并重启后端，再使用更新后的正式页面。本机已应用。

`0006_questionresponse` 新增问题回答表、申请外键、申请／题号唯一约束及题号／回答 CHECK，不给旧申请或新草稿预填答案。本机已备份并应用；其他设备仍须先备份、停写、迁移并重启后端，再使用问题页。问题评估从物料页“下一页”或第三个页签进入，第 5／13／14 题缺少条件性理由只提示，允许保存草稿。

`0007_ecractionresponse` 新增 ECR 行动填写表，申请／行动标识唯一及行动／状态 CHECK；不修改旧业务字段，不预填样例。本机已备份并应用，其他设备仍须备份、停写、迁移并重启后端。正式 ECR 在登录后的第四个页签，通过真实接口保存，不使用演示数据；局部测试为 `test changes.test_ecr`。MySQL 手动启动方式保留。

`0008_ecoactionresponse` 新增独立 ECO 填写表及申请／行动唯一、合法行动与状态约束；不修改既有业务数据、不复制源实例。本机已备份、停写并应用，旧业务表逐字段保持。其他设备仍须先备份、停写、迁移、重启后端再更新页面。第五个页签为 ECO 执行，ECR 下一页进入；新状态为“在实施阶段完成”，局部测试 `test changes.test_eco`。

`0009_emc_reference` 新增EMC参考、行、测试列、交叉格四表及归属约束；没有数据预填。本机已备份、停写并应用，六张旧业务表逐字段保持。其他设备先备份、停写、迁移、重启后端再使用第六页签。EMC接入批次只开放本人填写；0013起已接入按审核轮次授权的全站只读审核，管理员定义与规则维护暂不纳入 MVP；局部测试 `test changes.test_emc`。不执行早期A/B SQL草案来重复建表，实际SQL导出见 `docs/design/sql/emc-current.sql`。

`0010_executionplanresponse` 新增执行计划填写表、申请／活动唯一、二进制活动标识及日期顺序约束，没有预填或修改旧业务数据。本机已备份、停写并应用，旧十张表逐字段一致；其他设备仍须备份、停写、迁移并重启后端。第七页签在 EMC 后，通过 EMC 下一页进入；专项 `test changes.test_execution_plan`，记录见 [执行计划](testing/EXECUTION-PLAN-2026-10-03.md)。

### 实质性变更评估历史升级（0011）

实质性评估已包含在PR #3合并记录中。0011为该模块历史迁移，完整升级执行全部未应用迁移至0014，再同步重启前后端。本机0011交付时旧十一张业务表及#8保持，新旧申请均未预填；不手工复制数据库或样例。

入口：本人申请 → 实质性变更评估，或执行计划下一页。主表和A～E抽屉共用保存队列与人工组结论；关闭抽屉保留输入，自动保存不关闭抽屉。专项后端命令为 `test changes.test_significant_change --noinput`，前端为 `npm.cmd run test:significant-change`；交付时全量后端102项／前端57项及17组真实页面场景通过；首次读取校验修复后前端全量59项通过，后端及页面验证沿用交付记录。原表疑点、验证边界和备份证据见 [交付记录](testing/SIGNIFICANT-CHANGE-2026-10-04.md)。

### 提交批次历史升级（0012）

提交与锁定已包含在PR #3合并记录中。0012为该模块历史迁移，完整升级仍应用至0014并同步前后端；保留配置、备份开发库、停止本项目Django写入后执行上文migrate。不要手工修改申请status替代提交。

0012增加审核方式／提交时间及review_record，创建原生“审核员”组但不改变现有账号身份。本机已应用，十四张原业务表保持。实际使用前，在现有Django后台（本机8001的 `/admin/`）用技术管理员配置审核账号：创建至少两名有效普通用户，在用户的Groups中加入“审核员”，保存。无需给这些账号staff／superuser或Django模型权限。未加入组的账号为填写员，技术超级用户也不会自动成为业务审核员。组变更后刷新身份或重新登录；审核员现在可进入审核工作台执行本轮通过／退回和反馈。临时复验账号已清理；后续按用户要求创建了两名保留的演示审核员，见下文。

填写员打开本人草稿 → 提交审核（第九页），或实质性评估下一页。标题与ECR编号必填；指定至少选一名有效审核员，公开至少需要两名有效审核员存在。审核选择离开会丢失，正式提交后方式／名单／全部表单锁定；网络或异常响应使用查询结果／原请求重试，不反复改变名单。

专项后端为 `test changes.test_submission --noinput`，前端为 `npm.cmd run test:submission`。提交交付时114项真实MySQL、67项前端及17组真实页面通过；恢复修复后前端72项、lint/build及三组隔离界面时序通过；记录见 [提交与锁定](testing/SUBMISSION-2026-10-04.md)。该提交批次当时未包含审核动作；审核、退回及反馈现已接入0013，当前版本业务复验仍待完成。


### 本机保留的演示审核员

2026-10-04按用户要求创建 `demo_reviewer_1`（审核员1）、`demo_reviewer_2`（审核员2）：均已启用，加入“审核员”组，没有staff／superuser权限。随机密码保存在忽略的 `.local/reviewer-accounts.json`，不上传Git、不在日志显示。名单接口已验证两人可选，业务表未改变。刷新页面或重新登录以重新读取人员名单；审核工作台、通过／退回及反馈已接入，账号配置保持。

### 审核闭环历史升级（0013）

0013在原审核批次已应用，后续0014也已应用（均为2026-10-05交付记录，本次未重查数据库）。其他设备取得当前源码后，先保留配置并备份数据库、停写，再运行migrate并重启后端、更新前端；不要只更新前端。新增returned和轮次字段、review_round／review_feedback及轮次关联，旧实际提交会挂到第1轮，旧无元数据锁定记录不补造。原15张表字段和#8保持，两名保留审核员有效。

审核员登录 → 指定任务／公开审核／退回沟通／我的已处理记录 → 查看申请。“退回沟通”显示仍有权限的当前退回轮次，包括尚未个人批准的审核员；重新提交后旧轮移出该列表。审核员八张表只读，退回期间只看基本信息及意见；填写员本人在returned可修订并第九页再次提交，存在未解决正式意见时须全部回应并沿用原方式／名单；无正式未解决项时才允许更改安排。新轮重新审核，旧轮请求不可写入。0014已停止普通留言新增，改为逐条回应及原提出者复核；历史留言只读保留。

审核专项为 `test changes.test_review --noinput`，前端 `npm.cmd run test:review`。审核闭环交付时全量125项真实MySQL、76项前端、lint/build及13组真实页面通过。该0013批次的两项审查修复专项25项MySQL、16项前端、4项隔离浏览器模拟场景及lint/build通过，推送前全量127项真实MySQL及76项前端检查已重跑通过；业务复验另行记录。退回／第二轮／反馈已存在时，逆迁移在DDL前停止，不能用回退迁移撤销审核；需制定数据恢复方案。详情见 [交付记录](testing/REVIEW-WORKFLOW-2026-10-05.md)。

## 本机运行快照

2026-10-05正式意见交付记录载明旧设备前端localhost:5173及后端127.0.0.1:8001的CSRF入口均200，迁移至0014，未设置系统自启动；此前MySQL为Running／Manual。2026-10-07文档整理未重查服务或数据库，该快照不代表新设备或当前运行状态。历史备份和数据保持证据见[正式意见记录](testing/REVIEW-ISSUES-2026-10-05.md#备份迁移与原数据)。
