param(
    [ValidateSet('ecr', 'eco', 'all')][string]$Stage,
    [ValidateSet('draft', 'reviewing', 'pending_approval', 'approved', 'published', 'all')][string]$State,
    [string]$Applicant,
    [string]$Reviewer,
    [string]$Approver,
    [string]$Publisher
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONIOENCODING = 'utf-8'
if (-not $Stage) {
    $choice = Read-Host '流程：1 ECR，2 ECO，3 两种流程'
    $Stage = @{ '1' = 'ecr'; '2' = 'eco'; '3' = 'all' }[$choice]
    if (-not $Stage) { throw '请选择 1、2 或 3。' }
}
if (-not $State) {
    $choice = Read-Host '状态：1 草稿，2 审核中，3 待批准，4 已批准，5 已发布，6 全部'
    $State = @{ '1' = 'draft'; '2' = 'reviewing'; '3' = 'pending_approval'; '4' = 'approved'; '5' = 'published'; '6' = 'all' }[$choice]
    if (-not $State) { throw '请选择 1 到 6。' }
}
if (-not $Applicant) { $Applicant = Read-Host '申请人的已有登录名（其他人员默认相同，可用参数分别指定）' }
if ([string]::IsNullOrWhiteSpace($Applicant)) { throw '登录名不能为空。' }
$arguments = @('seed_workflow', '--stage', $Stage, '--state', $State, '--applicant', $Applicant)
foreach ($role in @('Reviewer', 'Approver', 'Publisher')) {
    $value = Get-Variable -Name $role -ValueOnly
    if ($value) { $arguments += @("--$($role.ToLowerInvariant())", $value) }
}
& (Join-Path $PSScriptRoot 'backend.ps1') @arguments
exit $LASTEXITCODE
