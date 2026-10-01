<#
.SYNOPSIS
  ZJYPH 运维面板启动器
  确保 127.0.0.1:3900 面板服务运行，然后以 Edge 应用窗口打开面板。

.DESCRIPTION
  用法：
    .\start-panel.ps1            # 启动服务（如未运行）并打开面板窗口
    .\start-panel.ps1 -Install   # 另外在桌面创建「ZJYPH运维面板」快捷方式

  服务启动后常驻后台（node server.mjs，隐藏窗口）；窗口关闭不影响服务，
  再次双击快捷方式会直接复用已运行的服务。
#>
[CmdletBinding()]
param([switch]$Install)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'runtime-config.json'
$port = 3900
if (Test-Path $configPath) {
  try {
    $runtimeConfig = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($runtimeConfig.panel.port) { $port = [int]$runtimeConfig.panel.port }
  } catch { Write-Host '提示：runtime-config.json 无法解析，使用默认面板端口 3900' -ForegroundColor Yellow }
}
$url = "http://127.0.0.1:$port"

# ── 0. 解析 node 路径（PATH 缺失时回退默认安装位置）──────────
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $candidate = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path $candidate) { $node = $candidate }
}
if (-not $node) { Write-Host '错误：未找到 node，请确认 Node 20 已安装' -ForegroundColor Red; exit 1 }

# ── 1. 检测端口，未监听则拉起服务 ────────────────────────────
function Test-Port {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $port)
    if ($task.Wait(800) -and $client.Connected) { return $true }
    return $false
  } catch { return $false } finally { $client.Close() }
}

if (-not (Test-Port)) {
  Start-Process -FilePath $node -ArgumentList "`"$root\server.mjs`"" -WorkingDirectory $root -WindowStyle Hidden
  $ok = $false
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-Port) { $ok = $true; break }
  }
  if (-not $ok) { Write-Host '错误：面板服务启动失败（端口 3900 未就绪）' -ForegroundColor Red; exit 1 }
  Write-Host '面板服务已启动'
} else {
  Write-Host '面板服务已在运行'
}

# ── 2. -Install：创建桌面快捷方式 ────────────────────────────
if ($Install) {
  # 快捷方式目标必须用完整路径：ShellExecute 对短名 powershell.exe 的 PATH 解析不可靠
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" }
  if (-not (Test-Path $psExe)) { Write-Host "错误：未找到 powershell.exe" -ForegroundColor Red; exit 1 }
  $ws = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = $ws.CreateShortcut("$desktop\ZJYPH运维面板.lnk")
  $lnk.TargetPath = $psExe
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\start-panel.ps1`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$node,0"
  $lnk.Description = 'ZJYPH 生产运维面板（进程/巡检/备份/日志/AI 修复）'
  $lnk.Save()
  Write-Host "桌面快捷方式已创建：$desktop\ZJYPH运维面板.lnk"
}

# ── 3. Edge 应用窗口打开面板 ─────────────────────────────────
$edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
          'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
  Start-Process -FilePath $edge -ArgumentList "--app=$url"
} else {
  Start-Process $url   # 回退默认浏览器
}
Write-Host "面板地址：$url"
