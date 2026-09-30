$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localConfiguration = Join-Path $projectRoot '.local\development.json'
if (Test-Path -LiteralPath $localConfiguration) {
    $configuration = Get-Content -Raw -Encoding UTF8 -LiteralPath $localConfiguration | ConvertFrom-Json
    foreach ($entry in $configuration.PSObject.Properties) {
        if ($null -eq [Environment]::GetEnvironmentVariable($entry.Name, 'Process')) {
            [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process')
        }
    }
}
$pythonExecutable = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'Project virtual environment is missing. See docs/DEVELOPMENT.md.'
}
[string[]]$djangoArguments = if ($args.Count -eq 0) { @('runserver', '127.0.0.1:8000') } else { @($args) }
Push-Location (Join-Path $projectRoot 'backend')
try {
    & $pythonExecutable manage.py @djangoArguments
    $djangoExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $djangoExitCode
