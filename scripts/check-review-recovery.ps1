#Requires -Version 7.0
param(
    [string]$PlaywrightModule = 'playwright',
    [string]$BaseUrl = 'http://localhost:5173'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$powershellExecutable = Join-Path $PSHOME 'pwsh.exe'
$backendScript = Join-Path $PSScriptRoot 'backend.ps1'
$fixtureCode = "exec(open('../scripts/review_recovery_fixture.py', encoding='utf-8-sig').read())"
$previous = @{}
foreach ($name in 'PLAYWRIGHT_MODULE', 'REVIEW_BASE_URL', 'REVIEW_FIXTURE_ACTION') {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$prepared = $false
Push-Location $projectRoot
try {
    $env:PLAYWRIGHT_MODULE = $PlaywrightModule
    $env:REVIEW_BASE_URL = $BaseUrl
    $env:REVIEW_FIXTURE_ACTION = 'prepare'
    & $powershellExecutable -NoProfile -ExecutionPolicy Bypass -File $backendScript shell -c $fixtureCode
    if ($LASTEXITCODE -ne 0) { throw 'Browser fixture preparation failed.' }
    $prepared = $true
    & node (Join-Path $PSScriptRoot 'review-recovery-browser.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Review recovery browser regression failed.' }
} finally {
    try {
        if ($prepared) {
            $env:REVIEW_FIXTURE_ACTION = 'cleanup'
            & $powershellExecutable -NoProfile -ExecutionPolicy Bypass -File $backendScript shell -c $fixtureCode
            if ($LASTEXITCODE -ne 0) { throw 'Browser fixture cleanup or original-data validation failed.' }
        }
    } finally {
        Pop-Location
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
    }
}
