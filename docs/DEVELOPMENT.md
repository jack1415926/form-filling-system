# 开发与演示

本文件只维护操作方法。进度见 [README](../README.md)，规则见 [MVP](MVP.md)，理解代码与下一批范围见 [项目开发梳理](PROJECT_GUIDE.md)；历史人工复验见 [复查记录](testing/REVIEW-2026-09-30.md#人工复验流程)。

## 环境与配置

技术基线：Node.js 24、Python 3.14、MySQL 8.4；依赖固定在 `backend/requirements.txt` 和 `frontend/package-lock.json`。当前机器已安装，无需重建环境。MySQL 服务为手动启动，重启电脑后如未运行，用服务管理器启动 `MySQL`。

当前项目目录为 `F:\codex_project\form_file_system`。虚拟环境含解释器的绝对路径，项目改名或移动后如 Python 启动失败，需重新定位环境，不能只移动目录。

后端从 `.local/development.json` 加载进程配置，已有同名环境变量优先。其他设备自行配置，不复制本机密码：

```json
{
  "DJANGO_SECRET_KEY": "本机随机密钥",
  "DJANGO_DEBUG": "1",
  "DB_NAME": "form_system",
  "DB_USER": "本机数据库用户",
  "DB_PASSWORD": "本机数据库密码",
  "DB_HOST": "127.0.0.1",
  "DB_PORT": "3306"
}
```

数据库须采用 `utf8mb4`、InnoDB。应用账号需要开发库建表及读写权限；运行测试还需要独立测试库 `test_form_system` 的创建/删除权限，不应使用其他业务库或管理员账号。

后端及前端代理默认使用 8000。本机该端口被占用，因此 `.local/development.json` 增加 `"BACKEND_PORT": "8001"`，`frontend/.env.local` 写入 `BACKEND_PORT=8001`；两份配置不提交，其他设备没有覆盖配置时仍使用 8000。

仅在缺少依赖时执行下列安装步骤；uv/Python/npm 缓存放在 F 盘项目 `.local`，代理设置仅对当前进程生效：

```powershell
$env:UV_CACHE_DIR = Join-Path $PWD '.local\uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $PWD '.local\python'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
uv python install 3.14 --no-bin --no-registry
uv venv --python 3.14 .venv
uv pip install --python .venv\Scripts\python.exe -r backend\requirements.txt
cd frontend
npm.cmd ci --cache ..\.local\npm-cache --proxy http://127.0.0.1:7890 --https-proxy http://127.0.0.1:7890
cd ..
```

### 改名后修复虚拟环境

本机已用下列命令完成修复。在新项目根目录执行，沿用上方 uv 缓存目录设置；解释器路径以实际安装为准。若沙箱拒绝访问现有缓存，在普通用户 PowerShell 中执行，不修改缓存 ACL。

```powershell
uv venv --allow-existing --python .local\python\cpython-3.14.6-windows-x86_64-none\python.exe .venv
uv pip install --offline --reinstall --python .venv\Scripts\python.exe -r backend\requirements.txt
```

这会重新生成启动器并按原锁定版本重装依赖，保留 `.local` 配置和数据库。修复后执行下方 Django 检查，再用后端脚本的 `showmigrations changes` 确认迁移状态。

## 启动与账号

在项目根目录用 MSI 安装的 PowerShell 7 启动后端：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1
```

另开窗口，在 `frontend/` 执行 `npm.cmd run dev`，打开 **http://localhost:5173**。前端通过 `/api` 代理访问后端，写入保留 CSRF 校验；不要混用 localhost 与 127.0.0.1。端口占用时先核对已有服务。`-ExecutionPolicy Bypass` 仅用于这一进程。

物料处置从正式申请详情的“物料明细”进入；升版／停用编辑抽屉内切换“物料信息／处置建议”，统一保存到数据库。原型已移除，`?preview=disposition` 不再提供内存样例。

演示账号保存在 `.local/demo-accounts.json`：`applicant` 用于填报，`other` 用于用户隔离检查，`admin` 用于 Django 管理后台。本机 `demo_applicant` 的申请 #8 已按要求补录源表概述、33 条物料、330 个处置值、27题及31条ECR填写；之后用户可继续修改，不与源Excel实时同步。样例及配置不随Git复制，新申请仍为空草稿。

需要其他账号时，用同一后端脚本执行 `createsuperuser`，再访问后端 `/admin/` 创建普通用户（默认 `http://127.0.0.1:8000/admin/`，本机为 8001）。单账号新登录会使其他独立会话失效；旧端未保存输入仍保留，可在页头或物料抽屉点击重新登录；使用原账号继续填写，切换账号会关闭原申请。人工测试使用演示账号，技术回归应使用独立测试账号。

## 本机运行快照

2026-10-04 实质性评估交付结束检查：MySQL Running／Manual，前端 `http://localhost:5173/` 与后端 `http://127.0.0.1:8001/api/auth/csrf/` 均返回200。本轮按需要启动了本项目两个隐藏开发进程，结束保持运行，没有设置系统自启动；以后仍按上文分别启动。

## 同步与迁移

2026-10-04 此前核对：PR #2 已合并，远端 `main` 为 `58224d5`；此前功能提交 [69ad8e7](https://github.com/jack1415926/form-filling-system/commit/69ad8e72389d55577a36d88bde276c611da4fafe) 已推送到 `codex/enforce-unique-change-numbers`，尚未合并到 main。获取自动保存、执行计划和最新保存恢复修复须同步该功能分支，不能只从 main 更新。保留各自 `.local`、前端本机配置和数据库，不复制密码；checkout 有未提交修改时先保留，不强行覆盖。代码同步后应用全部尚未执行迁移至 `0010_executionplanresponse`，不要手工执行历史 A/B SQL。

先备份开发数据库并停止 Django 写入服务，再在根目录执行：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 migrate --noinput
```

`0002_unique_numbers` 先按数据库排序规则检查重复非空编号，冲突时在 DDL 前停止并列出编号和申请 ID。由业务确认修正后重试，不自动删数据或改号。迁移回退只移除生成列和约束，申请数据保留，但唯一性保护也会失效。迁移完成后运行下列检查，再启动服务。

`0003_materialchange` 只新增三类物料表、申请外键及类别／Y/N 检查约束，不修改或预填已有申请。本机已应用；其他设备仍须执行迁移。后端若以 `--noreload` 运行，代码更新后必须重启，否则旧进程不会加载新增路由。

`0004_materialchange_request_id_and_more` 新增可空 UUID `request_id` 及申请／UUID 组合唯一约束，旧物料的 UUID 为 NULL，业务字段保留。本机已应用；更新前端去重逻辑前须先部署迁移及后端，再更新前端。

`0005_materialdisposition` 新增处置表、物料外键、位置唯一约束及位置／处置值 CHECK；原申请和物料字段不改，不预填 NA。先执行迁移并重启后端，再使用更新后的正式页面。本机已应用。

`0006_questionresponse` 新增问题回答表、申请外键、申请／题号唯一约束及题号／回答 CHECK，不给旧申请或新草稿预填答案。本机已备份并应用；其他设备仍须先备份、停写、迁移并重启后端，再使用问题页。问题评估从物料页“下一页”或第三个页签进入，第 5／13／14 题缺少条件性理由只提示，允许保存草稿。

`0008_ecoactionresponse` 新增独立 ECO 填写表及申请／行动唯一、合法行动与状态约束；不修改既有业务数据、不复制源实例。本机已备份、停写并应用，旧业务表逐字段保持。其他设备仍须先备份、停写、迁移、重启后端再更新页面。第五个页签为 ECO 执行，ECR 下一页进入；新状态为“在实施阶段完成”，局部测试 `test changes.test_eco`。

`0009_emc_reference` 新增EMC参考、行、测试列、交叉格四表及归属约束；没有数据预填。本机已备份、停写并应用，六张旧业务表逐字段保持。其他设备先备份、停写、迁移、重启后端再使用第六页签。EMC接入批次只开放本人填写；当前0013已接入按审核轮次授权的全站只读审核，管理员定义与规则维护暂不纳入 MVP；局部测试 `test changes.test_emc`。不执行早期A/B SQL草案来重复建表，实际SQL导出见 `docs/design/sql/emc-current.sql`。

`0010_executionplanresponse` 新增执行计划填写表、申请／活动唯一、二进制活动标识及日期顺序约束，没有预填或修改旧业务数据。本机已备份、停写并应用，旧十张表逐字段一致；其他设备仍须备份、停写、迁移并重启后端。第七页签在 EMC 后，通过 EMC 下一页进入；专项 `test changes.test_execution_plan`，记录见 [执行计划](testing/EXECUTION-PLAN-2026-10-03.md)。

## 检查

`0007_ecractionresponse` 新增 ECR 行动填写表，申请／行动标识唯一及行动／状态 CHECK；不修改旧业务字段，不预填样例。本机已备份并应用，其他设备仍须备份、停写、迁移并重启后端。正式 ECR 在登录后的第四个页签，通过真实接口保存，不使用演示数据；局部测试为 `test changes.test_ecr`。MySQL 手动启动方式保留。

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
npm.cmd run build
```

后端测试使用真实 MySQL 独立库 `test_form_system`，结束后销毁。`DB_TEST_NAME` 可覆盖测试库名，但不得与开发库同名（忽略大小写）；不使用 SQLite 替代。测试结果不能代替原设备验证或用户业务验收。

### 按修改范围运行测试

后端局部检查可把上述 `test changes` 改为 `test changes.test_materials`、`test changes.test_questions` 或具体的 `模块.类.测试方法`；查看耗时用 `test changes --noinput --durations 10 --timing`。普通功能测试的快速哈希器只在测试类生效，不修改生产密码配置。

布局／文案改动主要运行前端 lint/build；接口、权限、事务和迁移改动运行受影响后端测试，一批交付或合并前再运行全量。保留独立 MySQL 库、CSRF 和权限检查，不以减少测试数量为目标。计时基准见 [测试精简记录](testing/TEST-SIMPLIFICATION-2026-10-02.md)。

问题页保存状态修改还需运行 `test:questions`，使用 Node 原生测试检查局部 PATCH、结果未确认时恢复原值和失败分类；刷新／关闭与实际组件的重试流程另做浏览器回归，不能用这些纯逻辑测试代替。

概述／问题／EMC／执行计划／实质性评估页有未保存内容时切换页签，可选择“继续填写”“放弃修改并切换”或“保存并切换”；第三项复用当前页的校验及保存，成功才切页，失败留在原页。问题页顶部也可直接保存，无需滚到最底部。八页自动保存现已启用，范围、2 秒停顿、失败重试与首次物料手动创建见 [README](../README.md#待办)；刷新／关闭仍保留未保存保护，不具备本地异常退出恢复。

ECR 内存演示仍可访问 `http://localhost:5173/?preview=ecr`，不需要登录、MySQL 或后端，刷新恢复初始场景。正式填写请使用无查询参数的网站入口并登录，进入申请的 ECR 评估或 ECO 执行页签。`test:ecr-preview` 检查共用固定行动、演示联动及单条保存逻辑；正式接口验证见 [接入记录](testing/ECR-INTEGRATION-2026-10-02.md)。

## 实质性变更评估本批升级

实质性评估纳入本次Git提交；此前69ad8e7不包含该模块，其他设备应同步功能分支最新提交。取得本批源码后先保留本机配置、备份开发库并停写，再执行上面的migrate命令应用到 `0011_significant_change`，重启后端后使用新版前端。本机0011已应用；不手工复制数据库或样例。本批仅新增三张表与约束，旧十一张业务表及#8保持，新申请与旧申请均不预填。

入口：本人申请 → 实质性变更评估，或执行计划下一页。主表和A～E抽屉共用保存队列与人工组结论；关闭抽屉保留输入，自动保存不关闭抽屉。专项后端命令为 `test changes.test_significant_change --noinput`，前端为 `npm.cmd run test:significant-change
npm.cmd run test:submission
npm.cmd run test:review`；交付时全量后端102项／前端57项及17组真实页面场景通过；首次读取校验修复后前端全量59项通过，后端及页面验证沿用交付记录。原表疑点、验证边界和备份证据见 [交付记录](testing/SIGNIFICANT-CHANGE-2026-10-04.md)。

## 提交批次升级与审核账号配置

提交与锁定纳入本次Git提交，69ad8e7不包含它；其他设备应同步功能分支最新提交。其他设备取得本批源码后先保留配置并备份开发库、停止本项目Django写入，执行上文migrate应用至 `0012_submission`，重启后端再使用新版前端。角色及提交功能与迁移配套，不单独使用旧后端；不手工修改申请status来替代提交。

0012增加审核方式／提交时间及review_record，创建原生“审核员”组但不改变现有账号身份。本机已应用，十四张原业务表保持。实际使用前，在现有Django后台（本机8001的 `/admin/`）用技术管理员配置审核账号：创建至少两名有效普通用户，在用户的Groups中加入“审核员”，保存。无需给这些账号staff／superuser或Django模型权限。未加入组的账号为填写员，技术超级用户也不会自动成为业务审核员。组变更后刷新身份或重新登录；审核员现在可进入审核工作台执行本轮通过／退回和反馈。临时复验账号已清理；后续按用户要求创建了两名保留的演示审核员，见下文。

填写员打开本人草稿 → 提交审核（第九页），或实质性评估下一页。标题与ECR编号必填；指定至少选一名有效审核员，公开至少需要两名有效审核员存在。审核选择离开会丢失，正式提交后方式／名单／全部表单锁定；网络或异常响应使用查询结果／原请求重试，不反复改变名单。

专项后端为 `test changes.test_submission --noinput`，前端为 `npm.cmd run test:submission`。提交交付时114项真实MySQL、67项前端及17组真实页面通过；恢复修复后前端72项、lint/build及三组隔离界面时序通过；记录见 [提交与锁定](testing/SUBMISSION-2026-10-04.md)。该提交批次当时未包含审核动作；审核、退回及反馈现已接入0013，当前版本业务复验仍待完成。


### 本机保留的演示审核员

2026-10-04按用户要求创建 `demo_reviewer_1`（审核员1）、`demo_reviewer_2`（审核员2）：均已启用，加入“审核员”组，没有staff／superuser权限。随机密码保存在忽略的 `.local/reviewer-accounts.json`，不上传Git、不在日志显示。名单接口已验证两人可选，业务表未改变。刷新页面或重新登录以重新读取人员名单；审核工作台、通过／退回及反馈已接入，账号配置保持。

## 审核闭环升级（0013）

当前本机0013已应用。其他设备取得本次提交源码后，先保留配置并备份数据库、停写，再运行migrate并重启后端、更新前端；不要只更新前端。新增returned和轮次字段、review_round／review_feedback及轮次关联，旧实际提交会挂到第1轮，旧无元数据锁定记录不补造。原15张表字段和#8保持，两名保留审核员有效。

审核员登录 → 指定任务／公开审核／退回沟通／我的已处理记录 → 查看申请。“退回沟通”显示仍有权限的当前退回轮次，包括尚未个人批准的审核员；重新提交后旧轮移出该列表。审核员八张表只读，退回期间只看基本信息及意见；填写员本人在returned可修订并第九页再次提交，默认沿用但可更改名单。新轮重新审核，旧轮请求不可写入。自由文字反馈在本轮pending／returned可追加，旧轮和approved只读。

审核专项为 `test changes.test_review --noinput`，前端 `npm.cmd run test:review`。审核闭环交付时全量125项真实MySQL、76项前端、lint/build及13组真实页面通过。最新两项审查修复专项25项MySQL、16项前端、4项隔离浏览器模拟场景及lint/build通过，推送前全量127项真实MySQL及76项前端检查已重跑通过；业务复验另行记录。退回／第二轮／反馈已存在时，逆迁移在DDL前停止，不能用回退迁移撤销审核；需制定数据恢复方案。详情见 [交付记录](testing/REVIEW-WORKFLOW-2026-10-05.md)。
