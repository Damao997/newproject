# 部署进程隔离回归：执行真实脚本的等待函数，进程与等待均由测试替身提供。
[CmdletBinding()]
param([string]$DeployScript = '')
$ErrorActionPreference = 'Stop'
if (-not $DeployScript) { $DeployScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'deploy-zjyph.ps1' }
$taskSource = Get-Content -LiteralPath $DeployScript -Raw
$taskTokens = $null; $taskErrors = $null
$taskAst = [System.Management.Automation.Language.Parser]::ParseInput($taskSource, [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count) { throw '部署脚本语法错误' }
$taskAssignment = $taskAst.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$prodDirToken' }, $true)
$taskWait = $taskAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-ProductionProcessesExit' }, $true)
if (-not $taskAssignment -or -not $taskWait) { throw '缺少真实部署等待实现' }
$ProdDir = 'D:\ZJYPHFA'
Invoke-Expression $taskAssignment.Extent.Text
Invoke-Expression $taskWait.Extent.Text
$script:taskSleepCount = 0
$script:taskRelease = $false
$script:taskOtherProcesses = @(
  [pscustomobject]@{ Name='postgres.exe'; CommandLine='D:\ZJYPHFA-dev\server\native\postgres.exe -D D:\ZJYPHFA-dev\server\.pgdata -p 5432' },
  [pscustomobject]@{ Name='postgres.exe'; CommandLine='C:\Users\test\.codex\worktrees\frontend\ZJYPHFA\server\native\postgres.exe -D C:\Users\test\.codex\worktrees\frontend\ZJYPHFA\server\.pgdata -p 5434' },
  [pscustomobject]@{ Name='postgres.exe'; CommandLine='D:\ZJYPHFA-other\native\postgres.exe -D D:\ZJYPHFA-other\data' }
)
function Get-CimInstance { [CmdletBinding()] param([string]$ClassName) if ($ClassName -ne 'Win32_Process') { throw '测试只允许读取进程替身' }; return $script:taskProcesses }
function Start-Sleep { param([int]$Seconds) $script:taskSleepCount++; if ($script:taskRelease) { $script:taskProcesses = $script:taskOtherProcesses } }
$script:taskProcesses = $script:taskOtherProcesses
Wait-ProductionProcessesExit -TimeoutSeconds 2
if ($script:taskSleepCount -ne 0) { throw '等待函数误识别开发或测试进程' }
Write-Host '[PASS] 同名工作树、开发库和测试库不会阻塞生产发布'
$taskProduction = @(
  [pscustomobject]@{ Name='postgres.exe'; CommandLine='d:\ZJYPHFA\server\native\postgres.exe -D d:\ZJYPHFA\data -p 5433' },
  [pscustomobject]@{ Name='node.exe'; CommandLine='node D:\ZJYPHFA\server\dist\src\server.js' },
  [pscustomobject]@{ Name='esbuild.exe'; CommandLine='D:\ZJYPHFA\server\node_modules\esbuild\esbuild.exe --service' }
)
foreach ($taskProcess in $taskProduction) {
  $script:taskProcesses = @($taskProcess) + $script:taskOtherProcesses
  $taskRejected = $false
  try { Wait-ProductionProcessesExit -TimeoutSeconds 1 } catch { if ($_.Exception.Message -like '*生产进程未在限定时间内退出*') { $taskRejected = $true } else { throw } }
  if (-not $taskRejected) { throw ('未阻止仍在运行的生产进程：' + $taskProcess.Name) }
  Write-Host ('[PASS] 生产进程未退出时拒绝替换依赖：' + $taskProcess.Name)
}
$script:taskSleepCount = 0; $script:taskRelease = $true
$script:taskProcesses = $taskProduction + $script:taskOtherProcesses
Wait-ProductionProcessesExit -TimeoutSeconds 2
if ($script:taskSleepCount -ne 1) { throw '生产退出后的等待行为不正确' }
Write-Host '[PASS] 生产退出后继续发布，开发与测试进程保持不变'
