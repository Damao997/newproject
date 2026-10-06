<#
.SYNOPSIS
  ZJYPH 生产发布后冒烟验证（Windows / 非 Docker 环境）
  验证核心链路：后端健康、前端可达、鉴权生效、登录链路、审计日志落库

.DESCRIPTION
  由 deploy-zjyph.ps1 在发布流程末尾自动调用；也可单独运行：
    .\production-smoke-zjyph.ps1
  审计落库检查需要解析 server\.env 的 MIGRATE_DATABASE_URL 连接生产库。
  任一检查失败返回非 0 退出码。
#>
[CmdletBinding()]
param(
  [string]$ProdDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$PgToolsBin = ''
)

$ErrorActionPreference = 'Stop'
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
  catch { throw "runtime-config.json 无法解析：$($_.Exception.Message)" }
}
if (-not $PgToolsBin) { $PgToolsBin = if ($env:ZJYPH_PG_TOOLS_BIN) { $env:ZJYPH_PG_TOOLS_BIN } else { Join-Path $ProdDir 'tools\pgsql\bin' } }
$failures = @()

function Check {
  param([string]$Name, [scriptblock]$Body)
  try {
    & $Body | Out-Null
    Write-Host "  [PASS] $Name" -ForegroundColor Green
  }
  catch {
    Write-Host "  [FAIL] $Name：$($_.Exception.Message)" -ForegroundColor Red
    $script:failures += $Name
  }
}

function Get-DotEnvValue {
  param([string]$File, [string]$Name)
  $line = Get-Content $File | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -split '=', 2)[1].Trim() -replace '^"|"$', '')
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

Write-Host '==> ZJYPH 生产冒烟验证' -ForegroundColor Cyan

# 1. 后端健康检查
Check '后端 /health' {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/health" -TimeoutSec 8
  if ($r.data.service -ne 'up' -or $r.data.db -ne 'up') { throw '服务或数据库状态不是 up' }
}

# 2. 前端可达
Check '前端 8080 首页' {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/" -TimeoutSec 8 -UseBasicParsing
  if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
}

# 3. 鉴权生效（未带 token 访问需登录接口应 401）
Check '未授权访问返回 401' {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/api/v1/auth/profile" -TimeoutSec 8 -UseBasicParsing | Out-Null
    throw '预期 401 但请求成功'
  }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw "预期 401，实际 $($_.Exception.Response.StatusCode)" }
  }
}

# 4. 登录链路（自 v2026.10.9 起登录强制图形验证码：脚本无法反解 SVG 答案，
#    故断言「缺少验证码时被拒」——期望 400（校验失败）；兼容旧版本返回 401，同时触发审计）
Check '登录接口（强制图形验证码）' {
  $body = @{ username = 'smoke-test-user'; password = 'wrong-password-smoke' } | ConvertTo-Json
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/api/v1/auth/login" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 8 -UseBasicParsing | Out-Null
    throw '预期被拒绝但登录成功'
  }
  catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ne 400 -and $code -ne 401) { throw "预期 400（缺验证码）或 401（旧契约），实际 $code" }
  }
}

# 5. 审计通道可用（表可读且近 7 天有记录）。
#    说明：登录已被验证码前置拦截且失败不记审计，脚本无法在 2 分钟窗口内制造登录审计，
#    故此处退化为「审计写入通道可用」的连通性校验，避免凌晨发布时误报。
Check '审计日志通道可用' {
  $migrateUrl = Get-DotEnvValue $envFile 'MIGRATE_DATABASE_URL'
  if (-not $migrateUrl) { throw '.env 缺少 MIGRATE_DATABASE_URL' }
  $connection = ConvertFrom-PostgresUrl $migrateUrl

  $env:PGPASSWORD = $connection.Password
  # created_at 为无时区 timestamp 列（Prisma 按 UTC 写入），psql 会话须强制 UTC 才能正确比较
  $env:PGOPTIONS = '-c timezone=UTC'
  try {
    $count = & (Join-Path $PgToolsBin 'psql.exe') -h $connection.Host -p $connection.Port -U $connection.User -d $connection.Database -t -A -c "SELECT count(*) FROM audit_log WHERE created_at > now() - interval '7 days';" 2>$null
  }
  finally { Remove-Item Env:PGPASSWORD, Env:PGOPTIONS -ErrorAction SilentlyContinue }
  if ([int]($count | Select-Object -First 1) -lt 1) { throw '近 7 天无审计记录，审计通道疑似异常' }
}

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Host "冒烟验证未通过：$($failures -join '、')" -ForegroundColor Red
  exit 1
}
Write-Host '冒烟验证全部通过' -ForegroundColor Green
exit 0
