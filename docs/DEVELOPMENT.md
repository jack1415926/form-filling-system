# 安装、启动、更新与检查

更新日期：2026-10-16。技术基线为Node.js 24、Python 3.14、MySQL 8.4、PowerShell 7；依赖以backend/requirements.txt和frontend/package-lock.json为准。当前迁移终点0027，本机form_system已应用全部迁移，无待应用迁移；0027删除旧普通留言表review_feedback，其他设备须先核对该表是否还有需要保留的旧留言，再执行升级。完整结构见[字段与关系](design/DATABASE-ER-FULL.md)。功能和验收状态见[README](../README.md)，历史验证见[索引](testing/README.md)。

## 首次安装

克隆仓库并进入项目目录后，核对`node --version`、`python --version`及PowerShell 7。SSH不可用时用HTTPS；需要代理时仅给当前安装／Git进程配置，不修改全局Git代理。已有环境正常时不重新安装。

在MySQL中创建utf8mb4／InnoDB开发库及本机应用账号；示例密码必须替换：

```sql
CREATE DATABASE form_system CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'form_system_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_LOCAL_PASSWORD';
GRANT ALL PRIVILEGES ON form_system.* TO 'form_system_app'@'localhost';
GRANT ALL PRIVILEGES ON test_form_system.* TO 'form_system_app'@'localhost';
```

最后一项用于独立测试库的创建／删除；测试库不能与开发库同名，settings会拒绝该配置。上述仅本机开发权限，不作为生产授权方案。

在根目录创建本机配置`.local/development.json`，实际密钥和密码不提交Git：

```json
{
  "DJANGO_SECRET_KEY": "REPLACE_WITH_RANDOM_LOCAL_SECRET",
  "DJANGO_DEBUG": "1",
  "DB_NAME": "form_system",
  "DB_USER": "form_system_app",
  "DB_PASSWORD": "REPLACE_WITH_LOCAL_PASSWORD",
  "DB_HOST": "127.0.0.1",
  "DB_PORT": "3306",
  "DB_TEST_NAME": "test_form_system",
  "BACKEND_PORT": "8000"
}
```

脚本加载该文件，已有同名进程环境变量优先。后端端口默认8000，前端页面默认5173；改后端端口时同时设置上述BACKEND_PORT和`frontend/.env.local`的`BACKEND_PORT=所选端口`，然后重启两个进程。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Push-Location frontend
npm.cmd ci
Pop-Location
pwsh -NoProfile -File .\scripts/backend.ps1 migrate --noinput
pwsh -NoProfile -File .\scripts/backend.ps1 createsuperuser
```

业务账号可通过技术管理员的Django `/admin/` 创建。同一有效账号可发起本人申请，也可承担指定任务；旧“审核员”组已退出业务权限，“反馈管理员”组是独立附加权限，staff／superuser不自动获得业务授权。其他设备独立创建账号，不猜测匹配旧负责人文字。

## 日常启动与停止

2026-10-16新增普通用户内网启动入口（不需要 Windows 管理员权限）：

```powershell
pwsh -NoProfile -File scripts/start-lan.ps1
# 多块网卡时用 -LanIp 指定本机当前内网 IPv4
```

脚本读取本机配置、识别当前地址，前端监听 `0.0.0.0:5173`，后端和数据库保持本机连接。IP 允许列表及 CSRF 来源通过进程环境传给新启动的后端，不改写本地配置；前端代理优先使用进程的 BACKEND_PORT。已有服务经代理／CSRF校验通过则复用；旧服务配置不匹配时明确提示先停止，不自动结束已有进程。用户启动的后台服务可在任务管理器按项目进程路径及命令行确认后结束；前台启动仍使用 Ctrl+C。

若 MySQL 未运行，本机已有的 `.local/mysql/start.ps1` 可作为普通用户启动本机配置中的数据库实例及网页；该本机脚本、MySQL 安装和数据不随 Git 分发。其他设备若没有该启动器，应先由用户启动自己的 MySQL 实例，再运行此入口。不会安装或启动需要管理员权限的 Windows 系统服务，也不改防火墙。首次使用其他设备仍按上文完成环境配置；跨电脑访问需现有防火墙／公司网络允许，见[内网说明](COMPANY-LAN.md)。

五种状态测试数据：`pwsh -NoProfile -File scripts/test-data.ps1`，可选择流程、状态和已有账号，详见[测试数据说明](TEST-DATA.md)。

在根目录终端启动后端：

```powershell
pwsh -NoProfile -File .\scripts/backend.ps1
```

另一终端在frontend目录运行`npm.cmd run dev`。浏览器统一打开**http://localhost:5173/**，由Vite代理`/api`；不要混用localhost和127.0.0.1作为前端地址，避免Cookie／CSRF问题。后端默认127.0.0.1:8000，实际端口以本机配置为准。

端口占用先查已有项目进程，不重复启动。结束网页服务在两个终端按Ctrl+C；保持MySQL运行不代表网页已启动，也不代表正式部署。本机历史内网配置见[COMPANY-LAN](COMPANY-LAN.md)，地址／网段需重新核验。

## 更新与迁移

先检查Git工作区，保留未提交内容、配置、业务原件及数据库。拉取代码不迁移数据库；含结构变更时先备份开发库并停止项目写入，再执行：

```powershell
pwsh -NoProfile -File .\scripts/backend.ps1 migrate --noinput
pwsh -NoProfile -File .\scripts/backend.ps1 showmigrations changes
pwsh -NoProfile -File .\scripts/backend.ps1 check --database default
```

确认迁移至0027后重启前后端。0019已有新阶段／任务、0020已有发布／来源、0021已有ECO任务／补充／发布、0022已有多人负责人／任务或指定批准记录、0023已有真实ECO创建或交接记录、0026已有完整轮次快照时，逆迁移拒绝丢失证据；不要删除数据绕过守卫。0026不回填旧轮次，完整历史从升级后的新提交开始保存。0027会删除review_feedback表及其中的旧普通留言，回退迁移只能重建空表，不能恢复原留言；本机执行前已确认该表为空，其他设备须单独核对。备份是否完成和是否做过恢复演练是不同事实。

`.venv`、`.local`、数据库、账号／密码、样例、原Excel及截图不随Git同步。项目移动后解释器启动失败，先核对`.venv/pyvenv.cfg`和安装Python位置，再重建虚拟环境，不删除配置或数据库。本机测试凭据统一在`.local/accounts.json`，按真实账号ID去重，不记录role；不随Git同步，其他设备自行配置。旧账号配置及停用脚本已删除。

## 清理其他设备的旧单流程

其他设备单独升级到0027；如仍有stage=legacy旧申请，可在停止写入后通过Django shell删除这些申请及旧审核员／填写员组。仅按stage=legacy筛选，不能按日期或状态删除当前ECR／ECO。当前不提供额外清理命令，也不保留停用测试／脚本归档。

## 检查与排障

在根目录执行后端检查，在frontend目录执行前端检查：

```powershell
pwsh -NoProfile -File .\scripts/backend.ps1 test changes --noinput
pwsh -NoProfile -File .\scripts/backend.ps1 makemigrations --check --dry-run
Push-Location frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
Pop-Location
```

后端完整检查使用独立test_form_system，结束后销毁；需要MySQL可用及测试库权限。新阶段专项可选changes.test_eco_stage、changes.test_publication、changes.test_ecr_stage。测试快速哈希仅限测试类，生产保持默认强哈希。

登录失败先确认后端／代理及两端端口一致；服务在运行仍出现旧接口行为时核对进程版本，尤其`--noreload`进程须重启。网络超时保留输入与UUID，原账号重登查询；账号切换清理旧缓存。不能把构建成功、模拟页面或数据库连接失败当作真实业务验收。

当前测试入口及执行结果见[测试说明](testing/README.md)，保留断言的原因见[关键回归](testing/REGRESSIONS.md)。旧机器状态和历次上传过程不作为运行说明。
