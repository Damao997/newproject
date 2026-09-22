<#
.SYNOPSIS
  ZJYPH Windows 生产发布脚本：校验 tag → 备份 → 检出/构建 → 迁移 → 切换产物 → 验证。

.DESCRIPTION
  正式发布必须提供形如 v2026.09.2 的 tag。脚本从自身位置推导生产根目录，
  不绑定盘符；前端默认使用同源 /api/v1，由 serve-static.cjs 转发到后端。

.PARAMETER Tag
  要部署的正式发布 tag。
.PARAMETER ApiBaseUrl
  前端 API 基址，默认 /api/v1。只有明确采用跨域部署时才覆盖。
.PARAMETER ProdDir
  生产仓库根目录；默认由本脚本所在位置自动推导。
.PARAMETER AllowUntagged
  仅供本地演练。允许从当前提交构建，不得用于正式生产发布。
#>
[CmdletBinding()]
param(
  [string]$Tag = '',
  [string]$ApiBaseUrl = '/api/v1',
  [string]$ProdDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$AllowUntagged,
  [switch]$SkipBackup,
  [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
$serverDir = Join-Path $ProdDir 'server'
$webDir = Join-Path $ProdDir 'web'
$envFile = Join-Path $serverDir '.env'
$runtimeFile = Join-Path $ProdDir 'ops-panel\runtime-config.json'
$backendPort = 3100
$frontendPort = 8080

function Step {
  param([string]$Msg)
  Write-Host ''
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Get-DotEnvValue {
  param([string]$File, [string]$Name)
  $line = Get-Content $File | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -split '=', 2)[1].Trim() -replace '^"|"$', '')
}

function Assert-LastExitCode {
  param([string]$Message)
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Resolve-Pm2Command {
  $command = Get-Command 'pm2.cmd' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @()
  if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'npm\pm2.cmd') }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\pm2.cmd') }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\pm2.cmd') }
  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) { throw "未找到 pm2.cmd；已检查 PATH 及：$($candidates -join '、')" }
  return $found
}

Step '0/6 发布前检查'
if (-not (Test-Path $envFile)) { throw "未找到 $envFile，请从 .env.production.example 创建生产配置" }
if (-not (Test-Path (Join-Path $ProdDir '.git'))) { throw "$ProdDir 不是独立生产 Git 工作区" }

# 发布前显式确认当前生产数据目录，防止因配置丢失误启空库。
$dataDir = Get-DotEnvValue $envFile 'ZJYPH_DATA_DIR'
if (-not $dataDir) { throw '.env 缺少 ZJYPH_DATA_DIR，拒绝发布以避免误启空库' }
if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  throw "ZJYPH_DATA_DIR 不是已初始化的 PostgreSQL 数据目录：$dataDir"
}

if (Test-Path $runtimeFile) {
  try {
    $runtime = Get-Content -Raw $runtimeFile | ConvertFrom-Json
    if ($runtime.services.backendPort) { $backendPort = [int]$runtime.services.backendPort }
    if ($runtime.services.frontendPort) { $frontendPort = [int]$runtime.services.frontendPort }
  }
  catch { throw "runtime-config.json 无法解析：$($_.Exception.Message)" }
}
if ($env:ZJYPH_BACKEND_PORT) { $backendPort = [int]$env:ZJYPH_BACKEND_PORT }
if ($env:ZJYPH_FRONTEND_PORT) { $frontendPort = [int]$env:ZJYPH_FRONTEND_PORT }
foreach ($runtimePort in @($backendPort, $frontendPort)) {
  if ($runtimePort -lt 1 -or $runtimePort -gt 65535) { throw "运行时端口非法：$runtimePort" }
}
$pm2Command = Resolve-Pm2Command

git -C $ProdDir diff --quiet --
if ($LASTEXITCODE -ne 0) { throw '生产工作区存在未提交的已跟踪文件改动，拒绝发布' }
git -C $ProdDir diff --cached --quiet --
if ($LASTEXITCODE -ne 0) { throw '生产工作区存在已暂存改动，拒绝发布' }

if ($AllowUntagged -and $Tag) { throw '-AllowUntagged 与 -Tag 不能同时使用' }
if (-not $Tag -and -not $AllowUntagged) { throw '正式发布必须通过 -Tag 指定发布 tag' }
if ($Tag -and ($SkipBackup -or $SkipSmoke)) { throw '正式 tag 发布禁止跳过备份或冒烟验证' }
if ($Tag) {
  if ($Tag -notmatch '^v\d{4}\.\d{2}\.\d+$') { throw "Tag 格式非法：$Tag" }
  git -C $ProdDir fetch origin --tags --prune
  Assert-LastExitCode '拉取远端 tag 失败'
  git -C $ProdDir rev-parse --verify "$Tag^{commit}" 2>$null | Out-Null
  Assert-LastExitCode "远端不存在可用 tag：$Tag"
  $tagType = (git -C $ProdDir cat-file -t "refs/tags/$Tag" | Select-Object -First 1).Trim()
  if ($tagType -ne 'tag') { throw "$Tag 不是带注释 tag，拒绝发布" }
  git -C $ProdDir merge-base --is-ancestor "$Tag^{commit}" origin/main
  if ($LASTEXITCODE -ne 0) { throw "$Tag 不属于 origin/main，拒绝发布" }
  Write-Host "正式发布目标校验通过：$Tag"
}

$logDir = Join-Path $ProdDir 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Write-Host "已创建日志目录：$logDir" -ForegroundColor Yellow
}

if ($SkipBackup) {
  Write-Host '跳过发布前备份（仅允许无 tag 演练）' -ForegroundColor Yellow
}
else {
  Step '1/6 发布前全量备份'
  & (Join-Path $serverDir 'scripts\backup-zjyph.ps1') -Action full
  Assert-LastExitCode '备份失败，中止发布'
}

Step '2/6 检出、安装依赖并分阶段构建'
if ($Tag) {
  git -C $ProdDir switch --detach $Tag
  Assert-LastExitCode "检出 $Tag 失败"
  $exactTag = (git -C $ProdDir describe --tags --exact-match 2>$null | Select-Object -First 1).Trim()
  if ($exactTag -ne $Tag) { throw "当前提交未精确匹配 tag：期望 $Tag，实际 $exactTag" }
  Write-Host "已检出正式发布：$Tag"
}

Push-Location $serverDir
try {
  & npm.cmd ci
  Assert-LastExitCode '后端 npm ci 失败'
  & npm.cmd run build
  Assert-LastExitCode '后端构建失败'
}
finally { Pop-Location }

$releaseRoot = Join-Path $webDir '.release'
$stagedWebDist = Join-Path $releaseRoot 'dist-next'
$previousWebDist = Join-Path $releaseRoot 'dist-previous'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path $stagedWebDist) { Remove-Item -LiteralPath $stagedWebDist -Recurse -Force }

$env:VITE_API_BASE_URL = $ApiBaseUrl
$env:BUILD_OUT_DIR = $stagedWebDist
if ($AllowUntagged) { $env:ALLOW_UNTAGGED_BUILD = '1' }
Push-Location $webDir
try {
  & npm.cmd ci
  Assert-LastExitCode '前端 npm ci 失败'
  & npm.cmd run build:prod
  Assert-LastExitCode '前端生产构建失败'
}
finally {
  Pop-Location
  Remove-Item Env:VITE_API_BASE_URL, Env:BUILD_OUT_DIR, Env:ALLOW_UNTAGGED_BUILD -ErrorAction SilentlyContinue
}
if (-not (Test-Path (Join-Path $stagedWebDist 'index.html'))) { throw '前端分阶段构建未产出 index.html' }

Step '3/6 数据库迁移'
$migrateUrl = Get-DotEnvValue $envFile 'MIGRATE_DATABASE_URL'
if (-not $migrateUrl) { throw '.env 缺少 MIGRATE_DATABASE_URL（超级用户迁移连接串）' }
$env:DATABASE_URL = $migrateUrl
Push-Location $serverDir
try {
  & npm.cmd run migrate:deploy
  Assert-LastExitCode 'prisma migrate deploy 失败'
}
finally {
  Pop-Location
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

Step '4/6 重启生产服务'
$currentWebDist = Join-Path $webDir 'dist'
if (-not (Test-Path $currentWebDist)) { throw "当前前端产物不存在：$currentWebDist" }
if (Test-Path $previousWebDist) { Remove-Item -LiteralPath $previousWebDist -Recurse -Force }
Move-Item -LiteralPath $currentWebDist -Destination $previousWebDist
try {
  Move-Item -LiteralPath $stagedWebDist -Destination $currentWebDist
}
catch {
  Move-Item -LiteralPath $previousWebDist -Destination $currentWebDist -ErrorAction SilentlyContinue
  throw
}

& $pm2Command startOrReload (Join-Path $serverDir 'zjyph-ecosystem.config.cjs') --only 'zjyph-backend,zjyph-frontend' --update-env
Assert-LastExitCode '后端/前端 PM2 重载失败'
Start-Sleep -Seconds 5

Step '5/6 健康检查'
$health = $null
for ($i = 0; $i -lt 10; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/health" -TimeoutSec 5
    break
  }
  catch { Start-Sleep -Seconds 3 }
}
if (-not $health -or $health.data.service -ne 'up' -or $health.data.db -ne 'up') { throw '后端 /health 或数据库检查失败' }

$front = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/" -TimeoutSec 5 -UseBasicParsing
if ($front.StatusCode -ne 200) { throw "前端返回 $($front.StatusCode)" }

# 同源代理必须返回 API JSON/401，不能被 SPA fallback 错误接管为 200 HTML。
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/api/v1/auth/profile" -TimeoutSec 5 -UseBasicParsing | Out-Null
  throw '前端同源代理意外返回成功状态'
}
catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -ne 401) {
    throw "前端同源 /api/v1 代理检查失败（HTTP $status）"
  }
}

if ($SkipSmoke) {
  Write-Host '跳过发布后冒烟验证' -ForegroundColor Yellow
}
else {
  Step '6/6 冒烟验证'
  & (Join-Path $serverDir 'scripts\production-smoke-zjyph.ps1') -ProdDir $ProdDir
  Assert-LastExitCode '冒烟验证未通过'
}

$currentVersion = if ($Tag) { $Tag } else { (git -C $ProdDir rev-parse --short HEAD).Trim() }
if (Test-Path $previousWebDist) { Remove-Item -LiteralPath $previousWebDist -Recurse -Force }
Write-Host ''
Write-Host "部署完成：$currentVersion" -ForegroundColor Green
