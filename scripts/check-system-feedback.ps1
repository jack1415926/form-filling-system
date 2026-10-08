#Requires -Version 7.0
param([string]$PlaywrightModule = 'playwright', [string]$BaseUrl = 'http://localhost:5173')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCode = "exec(open('../scripts/system_feedback_fixture.py', encoding='utf-8-sig').read())"
$taskPrevious = @{}
foreach ($taskName in 'PLAYWRIGHT_MODULE','FEEDBACK_BASE_URL','FEEDBACK_FIXTURE_ACTION','FEEDBACK_BACKEND_SCRIPT','FEEDBACK_POWERSHELL') { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
$taskPrepared = $false
Push-Location $taskRoot
try {
    $env:PLAYWRIGHT_MODULE = $PlaywrightModule
    $env:FEEDBACK_BASE_URL = $BaseUrl
    $env:FEEDBACK_BACKEND_SCRIPT = Join-Path $PSScriptRoot 'backend.ps1'
    $env:FEEDBACK_POWERSHELL = Join-Path $PSHOME 'pwsh.exe'
    $env:FEEDBACK_FIXTURE_ACTION = 'prepare'
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $env:FEEDBACK_BACKEND_SCRIPT shell -c $taskCode
    if ($LASTEXITCODE -ne 0) { throw 'Fixture preparation failed' }
    $taskPrepared = $true
    & node (Join-Path $PSScriptRoot 'system-feedback-browser.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Feedback browser regression failed' }
    & node (Join-Path $PSScriptRoot 'system-feedback-input-recovery-browser.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Feedback input recovery regression failed' }
} finally {
    try {
        if ($taskPrepared) {
            $env:FEEDBACK_FIXTURE_ACTION = 'cleanup'
            & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $env:FEEDBACK_BACKEND_SCRIPT shell -c $taskCode
            if ($LASTEXITCODE -ne 0) { throw 'Fixture cleanup failed' }
        }
    } finally {
        Pop-Location
        foreach ($taskEntry in $taskPrevious.GetEnumerator()) { [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process') }
    }
}
