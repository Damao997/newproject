<#
.SYNOPSIS
  ZJYPH 生产一键部署脚本（Windows / 非 Docker 环境）
  固化发布 checklist：备份 → 迁移 → 构建 → 重启 → 健康检查 → 冒烟验证

.DESCRIPTION
  用法（发布流程）：
    1. develop 合入 main 并打 tag（v2026.08.x）
    2. 在 D:\ZJYPH-prod 执行 git fetch --tags && git checkout <tag>
    3. 运行本脚本：.\deploy-zjyph.ps1 -Tag v2026.08.x
  依赖：
    - D:\ZJYPH-prod 生产目录（PM2 进程 zjyph-postgres / zjyph-backend / zjyph-frontend）
    - server\.env 已配置（含 MIGRATE_DATABASE_URL 超级用户迁移连接串）
    - pm2 已全局安装

.PARAMETER Tag
  要部署的 tag 名（如 v2026.08.2）。留空则使用当前检出状态（跳过 git 操作）。
.PARAMETER ApiBaseUrl
  生产前端访问后端的地址（默认 http://localhost:3100/api/v1）。
.PARAMETER SkipBackup
  跳过发布前备份（不推荐，仅演练时使用）。
.PARAMETER SkipSmoke
  跳过发布后冒烟验证。
#>
[CmdletBinding()]
param(
  [string]$Tag = '',
  [string]$ApiBaseUrl = 'http://localhost:3100/api/v1',
  [string]$ProdDir = 'D:\ZJYPH-prod',
  [switch]$SkipBackup,
  [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
$serverDir = Join-Path $ProdDir 'server'
$webDir = Join-Path $ProdDir 'web'
$envFile = Join-Path $serverDir '.env'

function Step {
  param([string]$Msg)
  Write-Host ''
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Get-DotEnvValue {
  param([string]$File, [string]$Name)
  $line = Get-Content $File | Where-Object {
    $_ -match "^\s*$([regex]::Escape($Name))\s*="
  } | Select-Object -First 1
  if (-not $line) { return $null }
  $value = ($line -split '=', 2)[1].Trim()
  $value = $value -replace '^"|"$', ''
  return $value
}

# ── 0. 前置检查 ─────────────────────────────────────────
Step '0/6 前置检查'
if (-not (Test-Path $envFile)) { throw "未找到 $envFile，请先完成生产环境配置" }
if (-not (Test-Path (Join-Path $serverDir 'node_modules'))) { throw 'server/node_modules 不存在，请先 npm ci' }
if (-not (Test-Path (Join-Path $webDir 'node_modules'))) { throw 'web/node_modules 不存在，请先 npm ci' }
# PM2 日志目录：ecosystem 配置的 out_file/error_file 不会自动创建，缺失时三个进程启动即 ENOENT
$logDir = Join-Path $ProdDir 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Write-Host "已创建 PM2 日志目录：$logDir" -ForegroundColor Yellow
}

if ($Tag) {
  git -C $ProdDir fetch --tags 2>&1 | Out-Null
  git -C $ProdDir checkout $Tag 2>&1 | Out-Null
  Write-Host "已检出 $Tag"
}

# ── 1. 发布前备份 ───────────────────────────────────────
if ($SkipBackup) {
  Write-Host '跳过发布前备份（-SkipBackup）'
}
else {
  Step '1/6 发布前全量备份'
  & (Join-Path $serverDir 'scripts\backup-zjyph.ps1') -Action full
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw '备份失败，中止发布' }
}

# ── 2. 数据库迁移（超级用户）────────────────────────────
Step '2/6 数据库迁移（prisma migrate deploy）'
$migrateUrl = Get-DotEnvValue $envFile 'MIGRATE_DATABASE_URL'
if (-not $migrateUrl) { throw '.env 缺少 MIGRATE_DATABASE_URL（超级用户迁移连接串）' }
$env:DATABASE_URL = $migrateUrl
Push-Location $serverDir
try {
  & npx.cmd prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy 失败' }
}
finally { Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }

# ── 3. 构建 ─────────────────────────────────────────────
Step '3/6 构建后端与前端'
Push-Location $serverDir
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw '后端构建失败' }
}
finally { Pop-Location }

$env:VITE_API_BASE_URL = $ApiBaseUrl
Push-Location $webDir
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
}
finally { Pop-Location; Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }

# 版本标识：构建后向 index.html 注入/更新 meta app-version（线上版本可查）
$tag = git -C $ProdDir describe --tags 2>$null
if ($tag) {
  # 非纯 tag（tag 后带提交数/哈希，如 v2026.08.1-3-g2a3b4c5）时取主版本段，保证前端版本号可解析
  $tag = $tag -replace '^(.+?)-[0-9]+-g[0-9a-f]+$', '$1'
  $index = Join-Path $webDir 'dist\index.html'
  if (Test-Path $index) {
    $html = [System.IO.File]::ReadAllText($index, [System.Text.Encoding]::UTF8)
    if ($html -imatch 'name="app-version"\s+content="([^"]*)"') {
      # 已存在 meta：更新 value（重复部署/升级 tag 时与当前版本保持一致）
      $html = $html -ireplace 'name="app-version"\s+content="[^"]*"', "name=""app-version"" content=""$tag"""
      Write-Host "版本标识已更新：$tag"
    } elseif ($html -imatch '<head>') {
      $html = $html -ireplace '<head>', "<head>`n  <meta name=""app-version"" content=""$tag"">"
      Write-Host "版本标识已注入：$tag"
    } else {
      Write-Host '版本标识注入失败：未找到 <head> 标签' -ForegroundColor Yellow
    }
    [System.IO.File]::WriteAllText($index, $html, (New-Object System.Text.UTF8Encoding($true)))
  }
}

# ── 4. 重启服务 ─────────────────────────────────────────
Step '4/6 重启生产服务'
pm2 restart zjyph-backend 2>&1 | Out-Null
pm2 restart zjyph-frontend 2>&1 | Out-Null
Start-Sleep -Seconds 5

# ── 5. 健康检查 ─────────────────────────────────────────
Step '5/6 健康检查'
$health = $null
for ($i = 0; $i -lt 10; $i++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3100/health' -TimeoutSec 5
    break
  }
  catch { Start-Sleep -Seconds 3 }
}
if (-not $health) { throw '后端 /health 检查失败，发布中止' }
Write-Host "后端健康：$($health | ConvertTo-Json -Compress)"

try {
  $front = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -TimeoutSec 5 -UseBasicParsing
  if ($front.StatusCode -ne 200) { throw "前端返回 $($front.StatusCode)" }
  Write-Host '前端 8080 正常（HTTP 200）'
}
catch { throw "前端检查失败：$($_.Exception.Message)" }

# ── 6. 冒烟验证 ─────────────────────────────────────────
if ($SkipSmoke) {
  Write-Host '跳过冒烟验证（-SkipSmoke）'
}
else {
  Step '6/6 冒烟验证'
  & (Join-Path $serverDir 'scripts\production-smoke-zjyph.ps1')
  if ($LASTEXITCODE -ne 0) { throw '冒烟验证未通过，发布中止' }
}

$curTag = git -C $ProdDir describe --tags 2>$null
if (-not $curTag) { $curTag = '未知' }
Write-Host ''
Write-Host '部署完成 ✔' -ForegroundColor Green
Write-Host "当前部署：$curTag"
