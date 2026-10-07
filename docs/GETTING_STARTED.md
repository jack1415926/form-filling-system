# 新设备上手：安装、启动与完整业务操作

更新日期：2026-10-07。适用于Windows新设备上前后端、MySQL和浏览器都在同一台电脑运行的开发／演示方式。以下从空数据库开始，不复制旧设备的账号或申请。局域网多人访问和正式部署需另行配置；当前服务只监听本机。

首次按第1～7步准备，第8步走业务流程。以后日常使用直接看第9步。当前功能和交付状态见[README](../README.md)，开发检查及更新代码见[开发说明](DEVELOPMENT.md)。

## 1. 准备软件与项目目录

先安装Git、MSI版PowerShell 7、Node.js 24、uv和MySQL Community Server 8.4。Python 3.14在第3步由uv准备；如已安装，可沿用。MySQL安装时保留自己的管理账号密码，并确认服务已启动。新设备的服务名称以实际安装为准，不一定是旧设备的`MySQL`。

打开PowerShell 7，检查命令可用：

```powershell
git --version
$PSVersionTable.PSVersion
node --version
npm.cmd --version
uv --version
```

在自己选定的父目录获取项目，然后进入根目录：

```powershell
git clone --branch codex/enforce-unique-change-numbers https://github.com/jack1415926/form-filling-system.git form_file_system
cd .\form_file_system
git log -5 --oneline
```

本批指南和问题回顾随文档提交推送到`codex/enforce-unique-change-numbers`，上述命令取得该分支的代码及文档；main已有产品功能，但本批文档尚未合并。以后main接收本批文档后可改用`--branch main`。需取得包含正式审核意见闭环的版本；当前本地记录为功能提交`85eb359`、PR #3合并提交`26c8168`，以后可能有更新。项目根目录应同时有`backend`、`frontend`、`scripts`和`docs`。后续注明“根目录”的命令都在这里执行。

若新设备也使用Clash且监听127.0.0.1:7890，Git下载命令可改为下面这一条；不修改全局代理：

```powershell
git -c http.proxy=http://127.0.0.1:7890 -c http.sslBackend=schannel clone --branch codex/enforce-unique-change-numbers https://github.com/jack1415926/form-filling-system.git form_file_system
```

不要重复执行两次clone；第一次失败时先检查是否已经留下目标目录。新设备不能假设存在旧设备的F盘路径。

## 2. 创建空数据库和应用账号

在MySQL Workbench中以本机数据库管理员连接127.0.0.1:3306，打开SQL查询窗口。以下只用于首次创建全新的演示库；若已有同名库或用户，先核对用途，不删除或覆盖。

把密码占位文字替换为自己设置的密码，执行：

```sql
CREATE DATABASE form_system CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'form_app'@'127.0.0.1' IDENTIFIED BY '替换为自己的数据库密码';
GRANT ALL PRIVILEGES ON form_system.* TO 'form_app'@'127.0.0.1';
SHOW GRANTS FOR 'form_app'@'127.0.0.1';
```

这里只给应用账号本项目库的权限，前后端使用`form_app`，不使用数据库管理员账号。项目表由后续Django迁移建立，不手工执行`docs/design/sql/`的历史草案。MySQL管理账号、应用数据库账号和网页登录账号是三类不同账号。

## 3. 安装项目依赖

在项目根目录执行。缓存放到所选项目所在磁盘；有F盘时优先将项目／缓存放F盘，不复制旧设备的`.venv`或`node_modules`：

```powershell
$env:UV_CACHE_DIR = Join-Path $PWD '.local\uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $PWD '.local\python'
uv python install 3.14 --no-bin --no-registry
uv venv --python 3.14 .venv
uv pip install --python .venv\Scripts\python.exe -r backend\requirements.txt
cd frontend
npm.cmd ci --cache ..\.local\npm-cache
cd ..
```

每条命令应正常完成后再继续。若需要Clash，在执行uv网络命令前设置下列变量；npm安装命令增加`--proxy http://127.0.0.1:7890 --https-proxy http://127.0.0.1:7890`。仅在新设备确实有这个代理时使用：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
```

成功标准：根目录有`.venv\Scripts\python.exe`，前端依赖安装无失败退出。

## 4. 建立新设备配置

创建`.local/development.json`，填入以下结构。两个占位值都要替换；密码与第2步一致，密钥可以在本机用下方命令生成：

```powershell
.\.venv\Scripts\python.exe -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

```json
{
  "DJANGO_SECRET_KEY": "替换为上方生成的随机密钥",
  "DJANGO_DEBUG": "1",
  "DB_NAME": "form_system",
  "DB_USER": "form_app",
  "DB_PASSWORD": "替换为自己的数据库密码",
  "DB_HOST": "127.0.0.1",
  "DB_PORT": "3306",
  "BACKEND_PORT": "8000"
}
```

JSON中密码若包含双引号或反斜杠，需按JSON语法转义。已有同名进程环境变量优先于该文件，配置修改后重新启动后端。

默认使用8000，不需要`frontend/.env.local`。若8000被其他服务占用，可在JSON中改为8001，并新建`frontend/.env.local`：

```dotenv
BACKEND_PORT=8001
```

修改端口后重启前后端。不要照搬旧设备的密码、密钥或账号文件；这些本机文件不会随Git下载，也不能提交到GitHub。

## 5. 初始化表结构并创建技术管理员

确认MySQL运行，在根目录执行。以下命令使用MSI版PowerShell 7的默认安装路径，安装位置不同时按实际路径修改：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 migrate --noinput
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 showmigrations changes
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 createsuperuser
```

迁移列表应包含`[X] 0014_review_issues`及之前全部迁移；Django check无问题。按提示设置技术管理员用户名、邮箱和密码。这只创建管理后台账号，业务填写员和审核员还需第7步创建。日常启动不用反复创建数据库或管理员。

## 6. 分别启动后端和前端

窗口A，项目根目录：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1
```

窗口B，先进入这个项目的`frontend`目录：

```powershell
npm.cmd run dev
```

两个窗口保持打开。默认后端为127.0.0.1:8000，前端为localhost:5173；使用8001配置时只改变后端地址。打开[正式网页](http://localhost:5173)，应显示登录页面；打开[后端CSRF入口](http://127.0.0.1:8000/api/auth/csrf/)，应返回成功响应（端口改动时调整地址）。后端根路径不是业务网页，访问根路径404不等于启动失败。

前端固定使用5173，已占用会报错而不会自动换端口；先核对占用者，不直接终止其他程序。网页统一使用`http://localhost:5173`，不要混用127.0.0.1或预览查询参数。

## 7. 配置业务账号

打开[管理后台](http://127.0.0.1:8000/admin/)（后端为8001时相应修改），用第5步技术管理员登录，在Users／用户中创建以下独立账号并设置密码：

| 账号示例 | 设置 | 用途 |
| --- | --- | --- |
| filler_1 | 启用，不加入“审核员”组 | 新建、填写、提交及修订申请 |
| reviewer_1 | 启用，在Groups／组中加入“审核员”并保存 | 审核及意见复核 |
| reviewer_2 | 同上 | 双人指定审核或公开审核 |

迁移0012会创建“审核员”组；业务审核员不需要staff／superuser或Django模型管理权限。技术管理员不会自动成为审核员，系统反馈的业务管理入口仍未实现。改组后刷新身份或重新登录。

这些名称是新设备可自行选用的示例，不是系统自动生成账号。旧设备的样例申请#8和账号不会出现；本指南也不自动导入Excel或旧数据库。

## 8. 走完整业务流程

1. 填写员登录正式网页，在“我的申请”新建练习草稿。填写概述、物料明细、问题评估、ECR、ECO、EMC、执行计划和实质性变更评估。新物料首次创建手动确认，其他实际修改支持停顿2秒自动保存；进入提交页前确认保存完成。ECR／ECO默认只显示已保存问题触发的行动，隐藏不删除旧填写。
2. 在“提交审核”页确认标题和ECR编号非空，编号未被其他申请占用。第一次可选择指定reviewer_1，确认提交；申请变为待审核，正文锁定。
3. 在另一浏览器或独立浏览器配置文件中以reviewer_1登录，从审核工作台打开申请，查看八表只读内容。若无需修改，批准后单人指定申请直接成为已批准。
4. 要验证修订闭环，另建申请并提交给reviewer_1。审核员从悬浮意见入口列出多条具体修改意见，注明页签及必要的题号／物料说明，再一次确认退回。
5. 填写员打开已退回申请，修改正文并等待保存完成，逐条填写及发送回应。全部未解决项回应后才可重提；有未解决项时须沿用原审核安排。未发送文字也会阻止重提，可以发送或明确清除。
6. 原提出者在重提后的待审核轮次结合正文复核各条意见，确认解决或继续要求修改。全部意见解决后，再执行正常批准；确认解决不算批准票。
7. 如需验证多人条件，另建申请选择指定两人或公开审核：指定两人须两人都通过；公开须两名不同审核员通过。同一人重复批准不会增加人数。

同一浏览器的普通窗口共享登录Cookie；两个隐私窗口也可能共享同一个隐私会话，因此使用独立浏览器或配置文件区分身份。同一账号的新登录会使旧会话失效。当前意见草稿没有本地异常退出恢复，保存／审核结果未知时使用页面查询或原请求重试，不反复刷新或重新发起不同请求。

完成标准：新设备上的申请能保存并重开恢复、提交锁定、退回修订与逐条复核，并最终达到已批准。独立系统反馈不在当前可操作范围；本指南经源码及文档核对，尚未在另一台设备实际执行，实际操作后的业务验收应另行记录。

## 9. 以后如何启动和停止

以后确认MySQL运行，再按第6步启动前后端即可；无需每天重装依赖、迁移或创建账号。停止前确认保存成功且无在途／未知结果操作，再在两个终端分别按Ctrl+C。停止前后端不会删除数据库，也不会自动停止MySQL。

更新代码时按[同步与迁移](DEVELOPMENT.md#同步与迁移)备份、停写、安装变化的依赖、迁移并重启；日常演示不要求运行全量测试。

## 10. 启动失败先查哪里

| 现象 | 先检查 |
| --- | --- |
| 提示虚拟环境不存在 | 是否完成第3步、是否在正确项目目录，是否复制／移动了旧环境 |
| KeyError或缺少配置 | `.local/development.json`路径、JSON语法及必填密钥／数据库字段 |
| MySQL连接拒绝 | 服务、DB_HOST／DB_PORT，数据库是否已创建 |
| Access denied | 应用账号密码、授权主机127.0.0.1及该库权限 |
| 缺表／未知字段 | 第5步迁移是否全部标为[X]，后端是否重启到当前源码 |
| 前端能打开但API失败 | 后端终端错误及前后端BACKEND_PORT是否一致 |
| 审核名单为空 | 账号启用、加入“审核员”组、刷新身份或重新登录 |
| CSRF失败／会话失效 | 统一网页地址、是否共用Cookie或同账号另处登录，按页面提示原账号重登 |

安装失败应保留错误信息及失败命令，先确认代理和依赖安装结果，不盲目清缓存或更改权限。局域网访问还涉及监听地址、允许主机及CSRF来源，不能只将localhost替换为设备IP。
