# 本机开发与演示

本文记录本机安装、配置、启动和验证方法。当前进度及待办统一见 [README](../README.md#当前进度)，业务规则见 [MVP](MVP.md)。

## 环境和本地配置

当前使用 Node.js 24、Python 3.14、MySQL 8.4。后端版本固定于 `backend/requirements.txt`，前端由 `frontend/package-lock.json` 固定；保持已有项目版本。

已有数据库配置与密钥已迁至项目根目录的 `.local/development.json`，该文件不提交 Git。启动脚本读取文件并设置进程环境变量；已有同名环境变量优先。`.local` 中的密码只用于当前电脑，不会进入仓库。新电脑首次配置可以复制下述结构并填写自己的值：

```json
{
  "DJANGO_SECRET_KEY": "替换为本机生成的随机密钥",
  "DJANGO_DEBUG": "1",
  "DB_NAME": "form_system",
  "DB_USER": "本机MySQL用户",
  "DB_PASSWORD": "本机MySQL密码",
  "DB_HOST": "127.0.0.1",
  "DB_PORT": "3306"
}
```

MySQL 数据库必须先存在并采用 `utf8mb4`；业务表采用 InnoDB。本机配置的数据库用户需要开发数据库的建表和读写权限，测试时还需独立测试库的创建和删除权限。

初次安装依赖，在项目根目录执行：

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd frontend
npm.cmd ci
cd ..
```

当前电脑这些依赖已安装，无需重复创建环境。

## 启动

在项目根目录打开一个 PowerShell 窗口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 migrate --noinput
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1
```

另开一个 PowerShell 窗口启动前端：

```powershell
cd frontend
npm.cmd run dev
```

浏览器打开 **http://localhost:5173**。前端通过 `/api` 代理访问本机 Django，登录使用会话 Cookie，所有写入保留 CSRF 校验。不要混用 `localhost` 与 `127.0.0.1` 作为前端地址。

同一账号新登录会使其他数据库登录会话失效，应用登录和 Django 管理后台登录均执行这一规则。首次更新后请重新登录一次；同一浏览器的多个窗口共享 Cookie，仍属于一个会话。旧端再次请求时会被拒绝，未保存输入不会被自动清除；可先保留或复制输入，再重新登录。自动测试使用独立数据库；浏览器会话测试使用专用临时账号，避免踢掉演示账号。

`-ExecutionPolicy Bypass` 仅用于启动脚本的这一进程，不会修改电脑永久执行策略。任一服务提示端口占用时，检查已有终端；同一项目已运行的服务可直接使用，不需再启动第二份。

## 演示账号

演示账号的用户名和随机密码保存在 `.local/demo-accounts.json`。第一个账号用于申请，其他账号用于检查用户隔离；账号名称不代表对应业务功能已实现。

需要自行准备账号时，通过 Django 自带管理后台创建，不开发账号管理页面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 createsuperuser
```

然后在 **http://127.0.0.1:8000/admin/** 登录，创建普通用户。业务申请者来自登录账号，CCB 负责人及设计负责人保留 Excel 中的文字填写方式。

## 检查与验收

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backend.ps1 test changes --noinput
cd frontend
npm.cmd run lint
npm.cmd run build
```

自动测试使用独立 MySQL 数据库 `test_form_system`，测试后销毁。可以使用环境变量 `DB_TEST_NAME` 指定其他测试库，但必须与开发数据库不同；不使用 SQLite 替代测试。

浏览器人工验收按 [复验流程](testing/REVIEW-2026-09-30.md#人工复验流程)执行；反馈保存在本机 `docs/testing/manual`，截图放入其 `images`，完成状态只更新在 README。

输入允许留空，草稿不执行完整提交必填校验；非法日期或过长的短文本会被拒绝。申请者、状态和时间由后端管理，不能通过保存请求修改。前端后台刷新不覆盖正在编辑的内容。

跨窗口操作时保持 Cookie 和 CSRF 校验；发现保存错误先保留输入并核对反馈。已确认编号规则见 MVP，验收前先核对 README 中的实现状态。

## 字段与边界

概述字段依据 `docs/FIELD_MAP.md` 对应原表。页面按填写任务组织，不复制 Excel 的合并单元格布局；本批不会导入、导出或运行 Excel 宏。原始填写实例留在本机，用于核对，不加入代码提交。

完整 [目录导航](../README.md#目录导航)只在 README 维护；本机密码文件及启动脚本保持原位置。
