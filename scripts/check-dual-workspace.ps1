#Requires -Version 7.0
param([string]$PlaywrightModule='playwright', [string]$BaseUrl='http://localhost:5173', [ValidateSet('dual','assignment','owners')][string]$Scenario='dual')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPrevious = @{}
foreach ($taskName in 'PLAYWRIGHT_MODULE','DUAL_BASE_URL','DUAL_FIXTURE_ACTION','DUAL_BACKEND_SCRIPT','DUAL_POWERSHELL') { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process') }
$taskPrepared = $false
Push-Location $taskRoot
try {
    $env:PLAYWRIGHT_MODULE=$PlaywrightModule; $env:DUAL_BASE_URL=$BaseUrl
    $env:DUAL_BACKEND_SCRIPT=Join-Path $PSScriptRoot 'backend.ps1'
    $env:DUAL_POWERSHELL=Join-Path $PSHOME 'pwsh.exe'
    $env:DUAL_FIXTURE_ACTION=if ($Scenario -eq 'assignment') { 'prepare_assignment' } elseif ($Scenario -eq 'owners') { 'prepare_owners' } else { 'prepare' }
    & $env:DUAL_POWERSHELL -NoProfile -File $env:DUAL_BACKEND_SCRIPT shell -c "exec(open('../scripts/dual_workspace_fixture.py', encoding='utf-8').read())"
    if ($LASTEXITCODE -ne 0) { throw 'Fixture preparation failed' }
    $taskPrepared=$true
    if ($Scenario -eq 'assignment') { & node scripts/assignment-access-browser.cjs } elseif ($Scenario -eq 'owners') { & node scripts/action-owners-browser.cjs } else { & node scripts/dual-workspace-browser.cjs }
    if ($LASTEXITCODE -ne 0) { throw 'Dual-workspace browser regression failed' }
} finally {
    try {
        if ($taskPrepared) {
            $env:DUAL_FIXTURE_ACTION='cleanup'
            & $env:DUAL_POWERSHELL -NoProfile -File $env:DUAL_BACKEND_SCRIPT shell -c "exec(open('../scripts/dual_workspace_fixture.py', encoding='utf-8').read())"
            if ($LASTEXITCODE -ne 0) { throw 'Fixture cleanup failed' }
        }
    } finally {
        foreach ($taskEntry in $taskPrevious.GetEnumerator()) { [Environment]::SetEnvironmentVariable($taskEntry.Key,$taskEntry.Value,'Process') }
        Pop-Location
    }
}
