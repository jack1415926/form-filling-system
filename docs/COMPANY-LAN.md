# 当前电脑的公司内网访问

配置日期：2026-10-09。

同事在当前公司网段内打开 **http://192.168.39.131:5173/**，使用各自的系统账号登录。提供服务的这台电脑需要保持开机、连接公司网络，前后端进程需要保持运行。

## 已完成的配置

- 前端 `frontend/vite.config.ts` 监听 `0.0.0.0:5173`，`/api` 继续代理到本机后端。
- 后端 `backend/backend/settings.py` 支持通过逗号分隔的 `DJANGO_ALLOWED_HOSTS` 和 `DJANGO_CSRF_TRUSTED_ORIGINS` 扩展原有允许列表。
- 当前设备的 `.local/development.json` 新增 `DJANGO_ALLOWED_HOSTS=192.168.39.131`、`DJANGO_CSRF_TRUSTED_ORIGINS=http://192.168.39.131:5173`，保留原密钥和数据库配置；该文件不提交 Git。
- Windows 防火墙规则 `FormFilling-LAN-5173`：允许入站 TCP 5173，限域网络、`WLAN 2` 接口、本机地址 `192.168.39.131`，来源限 `192.168.38.0/23`。
- 后端继续监听 `127.0.0.1:8000`。

原配置备份、启动日志及本机操作脚本位于 `.local/lan-access-20261009/`，不提交 Git。

## 已验证与待验证

已在提供服务的电脑上验证：Django check 无问题；前端监听 `0.0.0.0:5173`；通过局域网 IP 请求首页返回 200、CSRF 接口返回令牌；携带该地址的 Origin 和有效 CSRF 令牌提交无效账号，返回预期的账号密码错误，说明代理及 CSRF 校验链路通畅。防火墙规则已经读取核对。

另一台电脑的实际连接尚需验证：请同事打开上述地址。如果无法打开，在同事电脑的 PowerShell 执行：

```powershell
Test-NetConnection 192.168.39.131 -Port 5173
```

若 `TcpTestSucceeded` 为 False，核对两台电脑是否在上述网段、服务电脑是否仍在线。公司其他网段需要确认路由和访问策略，并按实际来源网段调整此防火墙规则；无线客户端隔离或公司网络策略需要 IT 处理。

## 重启

在项目根目录启动后端：

```powershell
pwsh -NoProfile -File .\scripts\backend.ps1
```

另开终端启动前端：

```powershell
cd frontend
npm.cmd run dev
```

已有服务运行时不要重复启动。网页本机入口仍可使用 `http://localhost:5173/`，同事使用局域网 IP 入口。

## IP 变化与撤销

换网络或 DHCP 地址变化后，重新确认 IP，并同步更新 `.local/development.json` 中两项地址和防火墙的本机地址／来源网段，再重启后端。不要直接复制该设备的地址到其他设备。

停止共享时，停止前端服务，并在管理员 PowerShell 中删除本次规则：

```powershell
Remove-NetFirewallRule -Name 'FormFilling-LAN-5173'
```

如需恢复只限本机监听，把 `frontend/vite.config.ts` 的 `host` 改回 `localhost`，删除本机配置中本次新增的两项，再重启前后端。

配置依据：[Vite server.host 与代理](https://vite.dev/config/server-options)、[Django ALLOWED_HOSTS](https://docs.djangoproject.com/en/6.0/ref/settings/#allowed-hosts) 和 [CSRF_TRUSTED_ORIGINS](https://docs.djangoproject.com/en/6.0/ref/settings/#csrf-trusted-origins)。
