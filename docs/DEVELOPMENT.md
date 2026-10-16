# 安装、启动与维护

更新日期：2026-10-16。**这台电脑已经配置好，平时直接看第一节。** 换电脑或从未安装过项目，才需要执行“首次安装”。本页用于开发和内网演示，正式部署另行安排。

## 平时启动：只执行这一条

在项目根目录打开 **PowerShell 7**。根目录就是同时包含README.md、backend、frontend、scripts的目录。

```powershell
pwsh -NoProfile -File scripts/start-lan.ps1
```

脚本会检查数据库，启动前后端，并打印可打开的地址。正常情况下会出现以下一种结果：

| 输出 | 含义及下一步 |
| --- | --- |
| 内网入口：http://某个IP:5173/ | 已启动并通过本机代理／CSRF检查，打开这个地址 |
| 已有服务可用，内网入口：… | 服务已在运行，直接打开；这不是重新加载后端代码 |
| 请用-LanIp指定当前内网IPv4 | 存在多个地址；在同一命令末尾加-LanIp和提示列表中实际要使用的地址 |
| 网页端口已有监听，请先停止… | 现有服务未通过检查；按下一节停止当前项目前后端后，再执行启动命令 |
| MySQL未启动／缺少本机配置 | 按“首次安装”核对配置与数据库；其他电脑需先启动自己的MySQL |

自己在服务电脑上也可打开 **[http://localhost:5173/](http://localhost:5173/)**。同事使用脚本输出的内网地址；保持前端地址一致，避免在同一操作中混用localhost和127.0.0.1。

这条命令会把前后端放到后台运行，命令返回或关闭PowerShell后，网页服务仍会运行。它不会自动安装依赖、迁移数据库、重启已有服务或修改防火墙。

本机的特殊情况：MySQL配置为127.0.0.1:3307且存在`.local/mysql/start.ps1`时，数据库未运行会调用该启动器。该启动器只保存在这台电脑上，不随Git分发。其他电脑先启动已安装的MySQL，再运行上述命令。

## 停止与重启

| 启动方式 | 停止方法 |
| --- | --- |
| 上述后台启动 | 在任务管理器“详细信息”中查看命令行，确认属于本项目后，结束前端Vite的node进程和后端runserver的Python进程 |
| 后文手动前台启动 | 分别在前端、后端两个终端按Ctrl+C |

关闭浏览器只会关闭页面，不会停止服务。后台启动后，在原PowerShell中按Ctrl+C也不会停止已经启动的后台进程。当前没有统一停止脚本；不要仅按node.exe或python.exe名称批量结束其他项目。

重启步骤是：**保存页面输入 → 停止本项目前后端 → 重新执行启动命令 → 刷新浏览器。** 数据库单独管理，普通前后端重启不需要停止MySQL。后台后端使用`--noreload`，修改Python代码或更新后端后须重启；重新运行启动命令可能只复用旧进程。

## 首次安装：仅在新环境执行

需要Node.js 24、Python 3.14、MySQL 8.4和PowerShell 7。已有环境正常时无需重复安装；依赖版本以backend/requirements.txt和frontend/package-lock.json为准。

### 1. 创建数据库及账号

先安装并启动MySQL，再以有权限的数据库账号执行下列示例。替换示例密码；这些是开发环境权限。

```sql
CREATE DATABASE form_system CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'form_system_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_LOCAL_PASSWORD';
GRANT ALL PRIVILEGES ON form_system.* TO 'form_system_app'@'localhost';
GRANT ALL PRIVILEGES ON test_form_system.* TO 'form_system_app'@'localhost';
```

最后一项用于自动化测试库的创建／删除，不影响平时启动。测试库必须与开发库不同。

### 2. 保存本机配置

在项目根目录创建`.local/development.json`，按实际MySQL设置填写；以下3306只是示例，不能用它覆盖另一台电脑已有的正确配置。密钥和密码不提交Git。

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

| 端口 | 用途 |
| --- | --- |
| 5173 | 浏览器访问的前端地址 |
| BACKEND_PORT，默认8000 | 前端代理连接的Django接口，保持本机监听 |
| DB_PORT | 已安装MySQL的实际监听端口，与网页端口不同 |

改后端端口时，同时把`frontend/.env.local`中的BACKEND_PORT设为同一个值，并重启前后端。后端脚本读取本机JSON；已有同名进程环境变量优先，旧终端中的覆盖值也需要核对。

### 3. 安装项目依赖并初始化

在项目根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Push-Location frontend
npm.cmd ci
Pop-Location
pwsh -NoProfile -File scripts/backend.ps1 migrate --noinput
pwsh -NoProfile -File scripts/backend.ps1 createsuperuser
```

最后一条创建Django管理账号。业务账号可在`/admin/`中创建；staff／superuser不自动获得申请、任务或发布权限。后续按第一节启动，使用已有业务账号登录。

## 手动分开启动：仅用于开发排障

先确保MySQL已运行，并停止同一项目的后台前后端。这种方式便于直接看日志；两个终端都要保持运行。

终端一，在项目根目录启动后端：

```powershell
pwsh -NoProfile -File scripts/backend.ps1
```

终端二，在项目根目录启动前端：

```powershell
Set-Location frontend
npm.cmd run dev
```

打开[http://localhost:5173/](http://localhost:5173/)。需要同事经内网访问时，使用第一节的统一入口，让脚本处理当前IP的允许主机和CSRF来源，详见[内网说明](COMPANY-LAN.md)。

## 更新代码与迁移

先保存输入、保留工作区改动及本机配置；数据库需要变更时，先备份并停止写入。Git更新本身不升级数据库。

在根目录执行：

```powershell
pwsh -NoProfile -File scripts/backend.ps1 migrate --plan
pwsh -NoProfile -File scripts/backend.ps1 migrate --noinput
pwsh -NoProfile -File scripts/backend.ps1 check --database default
```

当前迁移终点为0027。其他设备升级前，须核对review_feedback旧普通留言的保留要求：0027会删除该表，回退只能重建空表。0026不补造旧轮正文；已有任务、发布、交接或完整快照时，相关逆迁移守卫会拒绝丢失证据，不应删除数据绕过。完成后按“停止与重启”重新加载服务。

`.local`、`.venv`、数据库、凭据及源Excel不随Git同步。项目移动后虚拟环境失效时，重建解释器环境，保留本机配置和数据库。测试账号记录位于本机`.local/accounts.json`，其他设备自行配置。

## 失败时先看哪里

| 现象 | 先检查 |
| --- | --- |
| pwsh找不到 | 是否安装并使用PowerShell 7 |
| 缺少.local/development.json或.venv | 按首次安装补齐配置／依赖 |
| 数据库连接失败 | MySQL是否运行，DB_HOST／DB_PORT／账号是否正确 |
| 首页可打开，接口失败 | 前端代理端口是否与BACKEND_PORT一致，后端日志是否报错 |
| 登录出现CSRF错误 | 前端地址是否一致，当前IP是否改变；停止旧服务后重新运行统一入口 |
| 更新代码后仍是旧行为 | 是否复用了--noreload旧后端；完整重启前后端 |
| 本机能打开，同事打不开 | 按[内网说明](COMPANY-LAN.md)检查实际网络、已有防火墙规则及跨设备连接 |

后台日志通常在`.local/lan/backend.stderr.log`和`.local/lan/frontend.stderr.log`；若通过本机数据库启动器启动，则查看`.local/mysql/`下的同名日志。

自动化测试入口与测试库说明集中在[测试说明](testing/README.md)。日常启动无需先运行测试、生成样例或重新迁移。需要合成测试数据时见[测试数据说明](TEST-DATA.md)；生产部署、用户业务验收和跨设备验证分别确认。
