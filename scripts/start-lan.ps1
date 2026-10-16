param([string]$LanIp)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.local\development.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw '请先按 docs/DEVELOPMENT.md 配置 .local/development.json。' }
$configuration = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
foreach ($entry in $configuration.PSObject.Properties) {
    if ($null -eq [Environment]::GetEnvironmentVariable($entry.Name, 'Process')) {
        [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process')
    }
}
$addresses = @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {
    if ($_.OperationalStatus -eq 'Up') {
        $_.GetIPProperties().UnicastAddresses | ForEach-Object {
            if ($_.Address.AddressFamily -eq 'InterNetwork' -and -not [Net.IPAddress]::IsLoopback($_.Address) -and
                -not $_.Address.IPAddressToString.StartsWith('169.254.')) { $_.Address.IPAddressToString }
        }
    }
} | Sort-Object -Unique)
if (-not $LanIp) {
    if ($addresses.Count -ne 1) { throw "请用 -LanIp 指定当前内网 IPv4。可用地址：$($addresses -join ', ')" }
    $LanIp = $addresses[0]
}
if ($LanIp -notin $addresses) { throw 'LanIp 必须是当前电脑正在使用的非回环 IPv4 地址。' }
$env:DJANGO_ALLOWED_HOSTS = (@($env:DJANGO_ALLOWED_HOSTS -split ',') + $LanIp | Where-Object { $_ } | Sort-Object -Unique) -join ','
$env:DJANGO_CSRF_TRUSTED_ORIGINS = (@($env:DJANGO_CSRF_TRUSTED_ORIGINS -split ',') + "http://${LanIp}:5173" | Where-Object { $_ } | Sort-Object -Unique) -join ','

function Test-Port([string]$Address, [int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $client.Connect($Address, $Port); return $true } catch { return $false } finally { $client.Dispose() }
}
function Test-LanEntry {
    try {
        $csrf = Invoke-RestMethod "http://${LanIp}:5173/api/auth/csrf/" -SessionVariable lanSession -TimeoutSec 2
        $login = Invoke-WebRequest "http://${LanIp}:5173/api/auth/login/" -Method Post -Body '{}' -ContentType 'application/json' -WebSession $lanSession -Headers @{ Origin = "http://${LanIp}:5173"; 'X-CSRFToken' = $csrf.csrfToken } -SkipHttpErrorCheck -TimeoutSec 2
        return $login.StatusCode -eq 400 -and ($login.Content | ConvertFrom-Json).detail -eq '请输入用户名和密码。'
    } catch { return $false }
}
$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { '127.0.0.1' }
$dbPort = if ($env:DB_PORT) { [int]$env:DB_PORT } else { 3306 }
$backendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8000 }
# Restarting existing processes is explicit: their old IP/CSRF settings may differ.
if ((Test-Port '127.0.0.1' $backendPort) -or (Test-Port '127.0.0.1' 5173)) {
    if (Test-LanEntry) {
        Write-Output "已有服务可用，内网入口：http://${LanIp}:5173/ （代理／CSRF检查通过）"
        return
    }
    throw '网页端口已有监听。请先停止现有前后端，再运行此脚本以加载当前 IP 配置。'
}
if (-not (Test-Port $dbHost $dbPort)) {
    $mysqlLauncher = Join-Path $projectRoot '.local\mysql\start.ps1'
    if ($dbHost -eq '127.0.0.1' -and $dbPort -eq 3307 -and (Test-Path -LiteralPath $mysqlLauncher)) {
        # This machine's existing launcher starts its user-owned MySQL plus both web processes.
        & $mysqlLauncher
        if (-not (Test-Port $dbHost $dbPort)) { throw '普通用户 MySQL 启动失败，请查看 .local/mysql/mysql-error.log。' }
    } else {
        throw "MySQL ${dbHost}:$dbPort 未启动。请先由用户启动本机数据库，再运行本脚本；不会请求管理员权限。"
    }
}
$logDirectory = Join-Path $projectRoot '.local\lan'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
if (-not (Test-Port '127.0.0.1' $backendPort)) {
    Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile', '-File', ('"' + (Join-Path $PSScriptRoot 'backend.ps1') + '"'), 'runserver', "127.0.0.1:$backendPort", '--noreload') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'backend.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'backend.stderr.log') | Out-Null
}
if (-not (Test-Port '127.0.0.1' 5173)) {
    Start-Process -FilePath (Get-Command node).Source -ArgumentList @('node_modules\vite\bin\vite.js', '--host', '0.0.0.0', '--port', '5173') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'frontend.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'frontend.stderr.log') | Out-Null
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $entryReady = Test-LanEntry
    if ($entryReady) { break }
    Start-Sleep -Seconds 1
}
if (-not $entryReady) { throw '内网入口检查失败，请查看 .local/lan 或 .local/mysql 的服务日志。' }
Write-Output "内网入口：http://${LanIp}:5173/ （本机代理／CSRF检查通过；其他电脑仍需实际访问验证）"
Write-Output '无需 Windows 管理员权限；不会修改防火墙。若其他电脑连接失败，请由 IT 核对既有入站规则及公司网络策略。'
