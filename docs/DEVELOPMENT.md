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

## 同步与迁移

PR #1 已合并，其他设备可从 `main` 同步包含本批实现的代码；保留各自的 `.local`、前端本机配置和数据库，不复制本机密码。若 checkout 有未提交修改，先确认如何保留，不强行覆盖。当前本地分支与远端关系见 README。

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

`0009_emc_reference` 新增EMC参考、行、测试列、交叉格四表及归属约束；没有数据预填。本机已备份、停写并应用，六张旧业务表逐字段保持。其他设备先备份、停写、迁移、重启后端再使用第六页签。当前只有本人填写，管理员维护与审核待办；局部测试 `test changes.test_emc`。不执行早期A/B SQL草案来重复建表，实际SQL导出见 `docs/design/sql/emc-current.sql`。

## 检查

`0007_ecractionresponse` 新增 ECR 行动填写表，申请／行动标识唯一及行动／状态 CHECK；不修改旧业务字段，不预填样例。本机已备份并应用，其他设备仍须备份、停写、迁移并重启后端。正式 ECR 在登录后的第四个页签，通过真实接口保存，不使用演示数据；局部测试为 `test changes.test_ecr`。MySQL 手动启动方式保留。

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 makemigrations --check --dry-run
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 test changes --noinput
cd frontend
npm.cmd run lint
npm.cmd run test:api
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

概述／问题页有未保存内容时切换页签，可选择“继续填写”“放弃修改并切换”或“保存并切换”；第三项复用当前页的校验及保存，成功才切页，失败留在原页。问题页顶部也可直接保存，无需滚到最底部。本次没有启用自动保存；刷新／关闭仍依靠未保存保护。

ECR 内存演示仍可访问 `http://localhost:5173/?preview=ecr`，不需要登录、MySQL 或后端，刷新恢复初始场景。正式填写请使用无查询参数的网站入口并登录，进入申请的 ECR 评估或 ECO 执行页签。`test:ecr-preview` 检查共用固定行动、演示联动及单条保存逻辑；正式接口验证见 [接入记录](testing/ECR-INTEGRATION-2026-10-02.md)。
