<#
.SYNOPSIS
  ZJYPH 生产环境巡检（Windows / 非 Docker 环境）
  一键检查：进程状态、服务健康、磁盘空间、备份时效、数据库连接数

.DESCRIPTION
  建议每周运行一次（也可加入 Windows 计划任务）：
    .\ops-check-zjyph.ps1
  任一关键项失败返回非 0 退出码，便于计划任务告警。
#>
[CmdletBinding()]
param(
  [string]$ProdDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$BackupDir = '',
  [string]$PgToolsBin = ''
)

$ErrorActionPreference = 'Continue'
$serverDir = Join-Path $ProdDir 'server'
$envFile = Join-Path $serverDir '.env'
$runtimeFile = Join-Path $ProdDir 'ops-panel\runtime-config.json'
$backendPort = 3100
$frontendPort = 8080
if (Test-Path $runtimeFile) {
  try {
    $runtime = Get-Content -Raw $runtimeFile | ConvertFrom-Json
    if ($runtime.services.backendPort) { $backendPort = [int]$runtime.services.backendPort }
    if ($runtime.services.frontendPort) { $frontendPort = [int]$runtime.services.frontendPort }
  }
  catch { Write-Warning "runtime-config.json 无法解析，使用默认端口：$($_.Exception.Message)" }
}
if (-not $BackupDir) { $BackupDir = if ($env:ZJYPH_BACKUP_DIR) { $env:ZJYPH_BACKUP_DIR } else { Join-Path $ProdDir 'backup' } }
if (-not $PgToolsBin) { $PgToolsBin = if ($env:ZJYPH_PG_TOOLS_BIN) { $env:ZJYPH_PG_TOOLS_BIN } else { Join-Path $ProdDir 'tools\pgsql\bin' } }
$issues = @()
$warnings = @()

function Report {
  param([string]$Status, [string]$Msg)
  $color = switch ($Status) { 'OK' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } }
  Write-Host ("  [{0}] {1}" -f $Status, $Msg) -ForegroundColor $color
}

function Resolve-Pm2Command {
  $command = Get-Command 'pm2.cmd' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($env:APPDATA) {
    $candidate = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path $candidate) { return $candidate }
  }
  throw '未找到 pm2.cmd'
}

function ConvertFrom-PostgresUrl {
  param([string]$Url)
  try { $uri = [Uri]$Url }
  catch { throw 'MIGRATE_DATABASE_URL 不是合法 URI' }
  if ($uri.Scheme -notin @('postgresql', 'postgres')) { throw 'MIGRATE_DATABASE_URL 协议非法' }
  $userInfo = $uri.UserInfo -split ':', 2
  $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  if ($userInfo.Count -ne 2 -or -not $database) { throw 'MIGRATE_DATABASE_URL 缺少连接信息' }
  return [pscustomobject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = [Uri]::UnescapeDataString($userInfo[0])
    Password = [Uri]::UnescapeDataString($userInfo[1])
    Database = $database
  }
}

$pm2Command = Resolve-Pm2Command

Write-Host '==> ZJYPH 生产巡检报告' -ForegroundColor Cyan
Write-Host ("巡检时间：{0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# ── 1. PM2 进程状态 ─────────────────────────────────────
Write-Host ''
Write-Host '1. PM2 进程状态' -ForegroundColor Cyan
foreach ($name in @('zjyph-postgres', 'zjyph-backend', 'zjyph-frontend')) {
  # PS 5.1 的 ConvertFrom-Json 无法解析 pm2 jlist（大小写重复键），改用 describe 文本
  $desc = & $pm2Command describe $name 2>$null | Out-String
  if ($desc -match 'status[^\r\n]*online') {
    $restarts = 0
    if ($desc -match 'restarts[^\r\n]*?(\d+)') { $restarts = [int]$Matches[1] }
    Report 'OK' "$name online（重启次数：$restarts）"
  }
  elseif ($desc -match 'status[^\r\n]*(\S+)') {
    Report 'FAIL' "$name 状态异常：$($Matches[1])"
    $issues += $name
  }
  else {
    Report 'FAIL' "$name 未托管"
    $issues += $name
  }
}

# ── 2. 服务健康 ─────────────────────────────────────────
Write-Host ''
Write-Host '2. 服务健康' -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/health" -TimeoutSec 8
  if ($health.data.service -ne 'up' -or $health.data.db -ne 'up') { throw '服务或数据库状态不是 up' }
  Report 'OK' '后端 /health 与数据库正常'
}
catch { Report 'FAIL' "后端 /health 不可达：$($_.Exception.Message)"; $issues += 'backend' }

try {
  $front = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/" -TimeoutSec 8 -UseBasicParsing
  if ($front.StatusCode -eq 200) { Report 'OK' "前端 $frontendPort 正常" }
  else { Report 'FAIL' "前端返回 HTTP $($front.StatusCode)"; $issues += 'frontend' }
}
catch { Report 'FAIL' "前端不可达：$($_.Exception.Message)"; $issues += 'frontend' }

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/api/v1/auth/profile" -TimeoutSec 8 -UseBasicParsing | Out-Null
  Report 'FAIL' '同源 API 代理意外返回成功状态'; $issues += 'api-proxy'
}
catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 401) { Report 'OK' '同源 /api/v1 代理正常' }
  else { Report 'FAIL' "同源 API 代理异常：$($_.Exception.Message)"; $issues += 'api-proxy' }
}

# ── 3. 磁盘空间 ─────────────────────────────────────────
Write-Host ''
Write-Host '3. 磁盘空间' -ForegroundColor Cyan
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -in @('C', 'D') } | ForEach-Object {
  $freeGb = [math]::Round($_.Free / 1GB, 1)
  $usedPct = [math]::Round(($_.Used / ($_.Used + $_.Free)) * 100, 0)
  if ($freeGb -lt 10) { Report 'FAIL' "$($_.Name): 剩余 ${freeGb}GB（${usedPct}% 已用）"; $issues += "disk-$($_.Name)" }
  elseif ($freeGb -lt 30) { Report 'WARN' "$($_.Name): 剩余 ${freeGb}GB（${usedPct}% 已用）"; $warnings += "disk-$($_.Name)" }
  else { Report 'OK' "$($_.Name): 剩余 ${freeGb}GB（${usedPct}% 已用）" }
}

# ── 4. 备份时效 ─────────────────────────────────────────
Write-Host ''
Write-Host '4. 备份时效' -ForegroundColor Cyan
$latest = Get-ChildItem (Join-Path $BackupDir 'full') -Filter '*.dump.enc' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { Report 'FAIL' '未找到任何备份文件'; $issues += 'backup' }
else {
  $age = (Get-Date) - $latest.LastWriteTime
  $ageText = if ($age.TotalHours -lt 1) { "$([math]::Round($age.TotalMinutes)) 分钟前" } else { "$([math]::Round($age.TotalHours, 1)) 小时前" }
  if ($age.TotalHours -gt 30) { Report 'FAIL' "最近备份 $($latest.Name)（$ageText），超过 30 小时"; $issues += 'backup' }
  elseif ($age.TotalHours -gt 26) { Report 'WARN' "最近备份 $($latest.Name)（$ageText）"; $warnings += 'backup' }
  else { Report 'OK' "最近备份 $($latest.Name)（$ageText）" }
}

# ── 5. 数据库连接数 ─────────────────────────────────────
Write-Host ''
Write-Host '5. 数据库连接数' -ForegroundColor Cyan
try {
  $line = Get-Content $envFile | Where-Object { $_ -match '^MIGRATE_DATABASE_URL=' } | Select-Object -First 1
  if ($line) {
    $url = (($line -split '=', 2)[1].Trim() -replace '^"|"$', '')
    $connection = ConvertFrom-PostgresUrl $url
    $env:PGPASSWORD = $connection.Password
    try {
      $conn = & (Join-Path $PgToolsBin 'psql.exe') -h $connection.Host -p $connection.Port -U $connection.User -d $connection.Database -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();" 2>$null | Select-Object -First 1
      $connInt = [int]$conn
      if ($connInt -gt 50) { Report 'WARN' "当前连接数 $connInt（偏高）"; $warnings += 'connections' }
      else { Report 'OK' "当前连接数 $connInt" }
    }
    finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  }
  else { Report 'WARN' '.env 缺少 MIGRATE_DATABASE_URL，跳过连接数检查' }
}
catch { Report 'WARN' "连接数检查失败：$($_.Exception.Message)" }

# ── 汇总 ────────────────────────────────────────────────
Write-Host ''
if ($issues.Count -gt 0) {
  Write-Host "巡检发现 $($issues.Count) 项异常：$($issues -join '、')" -ForegroundColor Red
  exit 1
}
if ($warnings.Count -gt 0) {
  Write-Host "巡检完成，$($warnings.Count) 项警告：$($warnings -join '、')" -ForegroundColor Yellow
  exit 0
}
Write-Host '巡检全部正常' -ForegroundColor Green
exit 0
