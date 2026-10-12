# 开发与演示

更新日期：2026-10-12。ECR第一批行动闭环及[五项审查修复](testing/ECR-REVIEW-FIXES-2026-10-12.md)已技术交付，用户业务验收待完成；发布及ECO留在后两批。工作区迁移至0019、25张业务表，本批改动未提交／推送。当前汇总见[README](../README.md)，历史批次说明不作为当前完成清单。

本文件维护当前操作方法。功能进度见 [README](../README.md)，业务规则见 [MVP](MVP.md)，代码地图见 [项目开发梳理](PROJECT_GUIDE.md)。历史设备的运行快照见 [2026-10-05复验](testing/REVERIFICATION-2026-10-05.md)，不作为其他设备的当前配置。

## 环境与配置

技术基线：Node.js 24、Python 3.14、MySQL 8.4。后端依赖固定在 `backend/requirements.txt`，前端固定在 `frontend/package-lock.json`。所有根目录命令都在当前设备的项目目录执行，不依赖固定盘符。

先核对 `node --version`、`python --version`、MySQL服务和现有 `.venv`。已有环境能启动且依赖检查通过时无需重建。MySQL服务名称和启动方式以当前设备为准；若服务未运行，先启动它，不修改服务启动类型。

后端脚本从 `.local/development.json` 加载进程配置，已有同名环境变量优先。该文件不提交Git，其他设备配置自己的密钥和数据库凭据：

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

数据库须先存在，采用utf8mb4、InnoDB。应用账号需要开发库建表及读写权限；测试还需要独立测试库的创建/删除权限。默认测试库 `test_form_system` 必须与开发库不同，代码会拒绝相同名称。

后端及前端代理默认使用8000。只有当前设备端口占用时才选择其他空闲端口，并同时设置 `.local/development.json` 的 `BACKEND_PORT` 和 `frontend/.env.local` 的 `BACKEND_PORT=所选端口`，然后重启前后端。两份本机配置均不提交。

仅在缺少依赖时安装。确认 `python --version` 为Python 3.14、Node为24后，在项目根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Push-Location frontend
npm.cmd ci
Pop-Location
```

默认直连。只有当前设备确实需要代理时，才按已确认的本机代理地址为安装进程配置；不要复制另一设备的端口。项目移动或改名后，先检查虚拟环境是否能启动；启动器失效时按当前Python解释器位置重建项目虚拟环境，保留 `.local` 和数据库。

## 当前代码与迁移基线（2026-10-12）

本地main及本地origin/main引用为f5e3d92，ECR第一批及修复仍为未提交工作区改动，未联网核验远端。源码至0019_ecr_stage_tasks，25张业务表。本机从0016备份升级0017／0018／0019并核对旧数据的证据见第一批记录；本轮没有再次连接数据库检查迁移。服务实时核验为MySQL Stopped／Manual，5173及8001无监听，本轮不启动。

## 历史电脑运行快照（2026-10-09）

本轮仅处理当前电脑，不涉及正式部署及其他设备同步。main功能交付基线为61c4ef7（2026-10-09已推送），MySQL服务Running／Manual，迁移0001～0017均已应用，业务表23张。现有依赖完整，不重新安装或重建环境。

前端 **http://localhost:5173/**、后端 **http://127.0.0.1:8000/** 已在后台启动。首页200；代理身份接口未登录返回预期401；CSRF接口200。依赖、Django check、迁移一致性、前端lint/build通过；原包体积提示保留。初次本机核对未重复迁移；后续反馈扩展已备份并应用0017，核对原数据一致，使用独立临时账号回归并清理。操作证据见[本机记录](testing/CURRENT-MACHINE-2026-10-09.md)。初次启动日志在`.local/current-machine-20261009/`；反馈升级后的备份、迁移摘要及后端日志在`.local/feedback-conversation-20261009/`。最新记录见[反馈扩展](testing/FEEDBACK-CONVERSATION-2026-10-09.md)。

## 启动与账号

在项目根目录的PowerShell 7终端启动后端：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1
```

如果 `pwsh` 不在PATH，用当前设备PowerShell 7的实际安装路径调用 `pwsh.exe`。执行策略参数只作用于本次进程。

另开终端，在 `frontend/` 执行：

```powershell
npm.cmd run dev
```

打开 **http://localhost:5173/**。前端通过 `/api` 代理访问后端，登录使用会话Cookie，写入保留CSRF校验；不要混用localhost和127.0.0.1作为前端地址。若提示端口占用，先核对已有服务，不重复启动。

旧本机凭据曾分文件管理（文件名不决定业务权限，本轮不合并或删除账号文件）：

- `.local/applicant-accounts.json`：历史发起测试账号凭据。
- `.local/reviewer-accounts.json`：历史审核测试账号凭据。

2026-10-08历史配置为三个填写员user1～user3和三个审核员review1～review3，实际凭据以本机文件为准。旧混合配置已归档，不再从demo-accounts.json读取。这些账号均为普通用户，没有Django管理后台权限。其他设备的账号及密码由其本地配置维护，不随Git同步。

当前所有有效用户均可填写本人申请并被指定处理他人申请，不再按上述文件分成互斥身份。当前凭据文件及有效账号须在本机核对，不在文档公开密码。

账号ID与申请外键关联。修改用户名不迁移申请归属；新账号不自动复制另一设备的样例。旧设备的申请#8和Excel补录记录仅属于历史测试数据，新草稿不预填。

同一账号新登录会使其他独立会话失效；同一浏览器窗口共享Cookie。原账号重新登录可继续当前填写，切换账号会关闭原申请。回归使用独立临时账号，避免影响正在使用的测试账号。

## 业务账号与legacy审核配置

用现有技术管理员在后端 `/admin/` 创建或配置业务用户。默认后台为 **http://127.0.0.1:8000/admin/**；更改后端端口时使用对应地址。

所有有效用户可发起本人申请；新ECR选择行动负责人和发布人，允许本人任务，提交后按任务授权。legacy整单指定审核从有效用户中选择并排除申请者本人。“审核员”组仅兼容旧公开记录；staff／superuser不绕过业务归属。

若当前设备没有技术管理员，在根目录执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 createsuperuser
```

新ECR提交要求标题／ECR编号、27题及有效负责人／发布人；零任务须明确确认。阶段批准由任务确认和正式意见解决决定，结果字段仅负责人在处理中填写。legacy仍要求所选人员全部批准、排除本人并保留原重提安排；新增公开审核停用。当前发布人只是指定关系，发布及ECO接口尚未实现。

## 同步与迁移

### 系统反馈升级与管理员配置（2026-10-08）

当前源码迁移链至 **0019_ecr_stage_tasks**；0018增加ECR／ECO负责人外键，0019增加阶段／发布人指定和两张任务表；0017系统反馈双向沟通及0016审核消息已读仍保留。升级须先备份并停写，再应用全部未执行迁移并重启前后端。下文0014内容保留为审核意见批次说明，不是当前迁移终点。

在Django后台把选定的有效账号加入“反馈管理员”组，再刷新身份或重新登录。该组为附加权限，不改变用户在具体申请中的职责；superuser／staff不自动获得反馈管理权限。0015仅创建组，不自动加入任何账号。本机原三个填写员、三个审核员未被自动授权。

填写员和审核员从统一“意见与反馈”悬浮入口选择系统反馈或审核消息；有组权限的账号还在顶部显示“反馈管理”。用户提交后原文只读，可在本人反馈详情中追加追问或意见；管理员说明对提交者公开，关闭或重新打开须填写说明。存在系统反馈时0015逆迁移拒绝直接删除数据；存在用户追加事件时0017拒绝逆迁移，以免丢失用户／管理员沟通类型。

前后端运行且已有Playwright／Edge可用时执行 `pwsh -NoProfile -File scripts/check-system-feedback.ps1`；可用`-PlaywrightModule`指定现有模块位置、`-BaseUrl`指定前端地址。回归创建独立临时账号，正常或失败结束均清理，并核对该回归涵盖的业务数据及已有用户／组成员摘要；0017历史结构为23张业务表，当前0019模型为25张，旧系统反馈回归不等于新任务流程回归。证据位于忽略的`.local/system-feedback-browser/`。不复制其他设备的绝对模块路径。

该入口同时执行system-feedback-input-recovery-browser.cjs：所有API在独立浏览器上下文中模拟，验证取消／确认离开、同账号角色变化及未知请求恢复、换账号清理、旧账号迟到权限响应。模拟部分不写真实业务库，与实际接口回归证据分别记录。

历史交付：2026-10-09功能代码已通过 [61c4ef7](https://github.com/jack1415926/form-filling-system/commit/61c4ef7) 推送到GitHub的main，包含反馈追问、通知、逐条未读标记、同一反馈提醒刷新修复及0017。本地仍在main，但第一批及修复尚未提交／推送，不能直接把本机工作区能力当作远端已交付。下列步骤保留为以后其他设备更新时的操作方法，本轮不执行远端同步。

更新前检查Git工作区，保留未提交内容以及各设备的 `.local`、前端本机配置、数据库和原始资料，不强行覆盖。

含数据库变更的更新必须先备份开发库、停止项目写入服务，再在根目录执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 migrate --noinput
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 showmigrations changes
```

当前迁移链至 **0019_ecr_stage_tasks**。应用全部未执行迁移后重启后端和前端；尤其是 `--noreload` 后端不会自动载入源码更新。不要只更新前端或手工执行历史A/B SQL。

迁移保护：

- 0002先检查非空ECR/ECO编号重复，冲突时在DDL前停止；由业务确认修正，不自动删数据或改号。空编号仍允许重复。
- 后续八表迁移新增结构，不复制样例；0013为真实旧提交建立第1轮关联，不补造无提交元数据的审核。
- 0018增加两项可空负责人账号外键，不猜测匹配旧姓名；有关联数据时拒绝直接逆迁移，用户删除受外键保护。
- 0014增加正式意见及处理事件，旧普通留言保留只读。前后端须同步升级，批准/退回/回应/解决使用对应请求标识与载荷。
- 已有退回、后续轮次或反馈时，0013拒绝直接逆迁移；已有正式意见或处理事件时，0014拒绝逆迁移。恢复需按保留历史的数据方案进行，不能直接删表回退。

各迁移历史证据见 [编号与初期复查](testing/REVIEW-2026-09-30.md)、[审核轮次](testing/REVIEW-WORKFLOW-2026-10-05.md)和[正式意见](testing/REVIEW-ISSUES-2026-10-05.md)。

## 检查

在项目根目录运行：

```powershell
.\.venv\Scripts\python.exe -m pip check
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 makemigrations --check --dry-run
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 test changes --noinput
Push-Location frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
Pop-Location
```

`npm.cmd test` 运行 `tests/*.test.mjs` 的全部测试，包括material-save；专项脚本仍可单独执行。后端使用独立真实MySQL测试库，结束后销毁，不以SQLite替代。

局部后端测试把 `test changes` 改为具体模块，例如 `test changes.test_review_issues`；前端局部可执行 `npm.cmd run test:submission` 或 `test:review`。组件中的刷新保护、请求丢失及响应交错，还需浏览器回归，纯逻辑测试不能替代。

普通开发可分层运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 test changes --noinput --exclude-tag=migration
```

迁移/历史保护及结构升级链带有`migration`标签，可用`--tag=migration`单独执行。新建测试库仍执行所有安装迁移。修改模型/迁移或交付、合并前运行上方完整测试，不能用普通子集代替完整验证。2026-10-09最新反馈扩展全量为154项；实际数量随代码变化，以本次运行输出为准。

前后端服务运行且已有Playwright和Edge可用时，执行组件回归：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-review-recovery.ps1
```

默认从Node可解析的`playwright`模块加载；模块装在其他位置时，通过`-PlaywrightModule '当前设备的模块目录或入口文件'`指定，不复制另一设备路径。前端地址可用`-BaseUrl`覆盖。本次没有新增依赖，使用了本机已有模块。

脚本创建独立临时账号和申请，检查刷新保护、审核/提交丢响应及查询恢复；正常结束或回归失败时自动清理，并核对其覆盖的旧审核业务数据摘要；0017历史结构为23张，当前0019模型为25张，新增任务证据由ECR专项另行覆盖。日志与截图在`.local/review-recovery-browser`，不使用正在试填的六名测试账号。浏览器未启动或服务停止的错误不会把临时数据留作业务样例。

八表修改停顿2秒自动保存，新物料首次创建仍需手动确认。切页的放弃只丢弃未保存修改，不撤销已自动保存内容。刷新/关闭保护用于未保存文字、请求在途或未知结果，不提供异常退出后的本地恢复。

ECR内存演示仍可通过 `?preview=ecr` 访问，不需要后端；正式填报使用无查询参数入口并登录。功能检查与人工业务验收分开记录，不根据历史日志推断当前设备已验收。

## 统一账号工作台回归（2026-10-12）

前后端同步载入第一步代码；使用--noreload的后端需要重启。无需数据库迁移。独立回归入口：

```powershell
pwsh -NoProfile -File scripts/check-dual-workspace.ps1
```

可用-PlaywrightModule指定当前设备已有Playwright模块；脚本准备独立账号、执行真实与拦截页面场景、在finally清理，并核对原23张业务表及账号／组数据。第一步当时全量为158项MySQL、81项前端，历史数量仍保留为批次证据。

## 按指定关系授权回归（第二步，2026-10-12）

本批无迁移，前后端同步更新，--noreload后端需要重启。最小回归命令：

```powershell
pwsh -NoProfile -File scripts/check-dual-workspace.ps1 -Scenario assignment
```

按当前设备需要指定-PlaywrightModule。只验证两个临时普通账号之间的指定提交、处理和查看结果，结束后清理并核对原业务及账号／组摘要。第二步仅运行4项MySQL专项、16项相关前端和该实际链路；历史全量数字不能当作本批全量结果。

## 先前全面审查验证（历史批次，2026-10-12）

全面审查批次当时全量为166项真实MySQL、84项前端，lint/build通过；迁移仍至0018。全面页面回归及两项P2修复见[审查记录](testing/COMPREHENSIVE-REVIEW-2026-10-12.md)，旧全量／专项数字是当时批次证据。异常行动响应的完全模拟回归入口为scripts/action-owner-response-recovery-browser.cjs，使用现有Playwright模块，不写真实库。

## 第一批前测试整理（历史批次，2026-10-12）

该整理批次完整测试为161项真实MySQL、80项前端；旧数量按批次保留。八表能力回归在test_user_workspace，授权在test_assignment_access，混合提醒在test_review_inbox。共享行动定义专项为npm.cmd run test:action-definitions，旧test:ecr-preview入口已移除。删除和合并依据见[测试整理记录](testing/TEST-CLEANUP-2026-10-12.md)。

## ECR第一批升级与检查

本机已备份并从0016升级至0019，原数据核对及临时服务边界见第一批记录。其他设备仍须先备份、停写并检查自己的迁移，再应用全部未执行迁移；不能复制本机数据库或凭据。0019新增阶段字段及两张任务表，旧记录默认legacy，有新阶段或任务时拒绝直接逆迁移。

必要专项：`scripts/backend.ps1 test changes.test_ecr_stage --noinput`；前端新增响应检查：`node --test frontend/tests/ecr-stage.test.mjs`。测试使用独立MySQL库，数据库停止时需先恢复可用，不把模拟页面算作真实数据库通过。

## 第一批审查修复后的验证入口

最新已执行范围为18项前端专项、16项真实MySQL专项、1条全模拟API页面场景（9个断言）及build／lint；未重跑后端全量。本轮文档同步不执行这些命令。需要复验时优先运行受影响范围：

```powershell
node --test frontend/tests/ecr-recovery.test.mjs frontend/tests/ecr-stage.test.mjs frontend/tests/autosave.test.mjs
pwsh -NoProfile -File scripts/backend.ps1 test changes.test_ecr_stage changes.test_review_inbox --noinput
```

后端专项要求MySQL可用，仍使用独立测试库；本机当前停止，不能把连接失败算通过。页面隔离结果及服务恢复见[五项修复](testing/ECR-REVIEW-FIXES-2026-10-12.md)。其他设备的服务名、端口、凭据和迁移状态需自行核对。
