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
  [string]$ProdDir = 'D:\ZJYPH-prod'
)

$ErrorActionPreference = 'Stop'
$serverDir = Join-Path $ProdDir 'server'
$envFile = Join-Path $serverDir '.env'
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

Write-Host '==> ZJYPH 生产冒烟验证' -ForegroundColor Cyan

# 1. 后端健康检查
Check '后端 /health' {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3100/health' -TimeoutSec 8
  if (-not $r) { throw '空响应' }
}

# 2. 前端可达
Check '前端 8080 首页' {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -TimeoutSec 8 -UseBasicParsing
  if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
}

# 3. 鉴权生效（未带 token 访问需登录接口应 401）
Check '未授权访问返回 401' {
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/v1/auth/profile' -TimeoutSec 8 -UseBasicParsing | Out-Null
    throw '预期 401 但请求成功'
  }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw "预期 401，实际 $($_.Exception.Response.StatusCode)" }
  }
}

# 4. 登录链路（错误密码应 401，同时触发审计）
Check '登录接口（错误密码 401）' {
  $body = @{ username = 'smoke-test-user'; password = 'wrong-password-smoke' } | ConvertTo-Json
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/v1/auth/login' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 8 -UseBasicParsing | Out-Null
    throw '预期 401 但登录成功'
  }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw "预期 401，实际 $($_.Exception.Response.StatusCode)" }
  }
}

# 5. 审计日志落库（最近 2 分钟内应有本次登录尝试记录）
Check '审计日志落库' {
  $migrateUrl = Get-DotEnvValue $envFile 'MIGRATE_DATABASE_URL'
  if (-not $migrateUrl) { throw '.env 缺少 MIGRATE_DATABASE_URL' }
  if ($migrateUrl -notmatch 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(\S+)') { throw 'MIGRATE_DATABASE_URL 格式无法解析' }
  $pgUser = $Matches[1]; $pgPass = $Matches[2]; $pgHost = $Matches[3]; $pgPort = $Matches[4]; $pgDb = $Matches[5]

  $env:PGPASSWORD = $pgPass
  # created_at 为无时区 timestamp 列（Prisma 按 UTC 写入），psql 会话须强制 UTC 才能正确比较
  $env:PGOPTIONS = '-c timezone=UTC'
  try {
    $count = & 'D:\ZJYPH-tools\pgsql\bin\psql.exe' -h $pgHost -p $pgPort -U $pgUser -d $pgDb -t -A -c "SELECT count(*) FROM audit_log WHERE action IN ('login','login_failed') AND created_at > now() - interval '2 minutes';" 2>$null
  }
  finally { Remove-Item Env:PGPASSWORD, Env:PGOPTIONS -ErrorAction SilentlyContinue }
  if ([int]($count | Select-Object -First 1) -lt 1) { throw '最近 2 分钟无登录审计记录' }
}

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Host "冒烟验证未通过：$($failures -join '、')" -ForegroundColor Red
  exit 1
}
Write-Host '冒烟验证全部通过' -ForegroundColor Green
exit 0
