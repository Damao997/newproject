<#
.SYNOPSIS
  ZJYPH 生产数据库备份脚本（Windows / 非 Docker 环境）
  浙江壹品慧财年经营数据分析平台 — 生产库 zjyph_prod 全量备份、校验、恢复与清理

.DESCRIPTION
  与 server/scripts/backup.sh（Docker 版）职责对应，但采用 Windows 原生实现：
    - pg_dump 来自 D:\ZJYPH-tools（PostgreSQL 官方 zip 二进制，免安装）
    - 加密使用 .NET AES-256（不依赖 openssl）
    - 备份文件命名：zjyph_prod_YYYYMMDD_HHMMSS.dump.enc（头部 16 字节为 IV）
  连接参数通过环境变量传入（与 pg 工具惯例一致）：
    PGHOST=127.0.0.1  PGPORT=5433  PGDATABASE=zjyph_prod  PGUSER=postgres  PGPASSWORD=<超级用户密码>
  加密密钥：环境变量 ZJYPH_BACKUP_KEY（要求 >= 32 字符，由部署者单独保管）

.PARAMETER Action
  full    全量备份（默认）
  verify  校验指定备份文件可解密且结构完整
  restore 从备份恢复（破坏性，需 -ConfirmRestore 与交互确认）
  cleanup 清理 N 天前的旧备份

.EXAMPLE
  $env:ZJYPH_BACKUP_KEY = "xxx"; .\backup-zjyph.ps1 -Action full
  .\backup-zjyph.ps1 -Action verify -BackupFile D:\ZJYPH-backup\zjyph_prod_20260807_020000.dump.enc
#>
[CmdletBinding()]
param(
  [ValidateSet('full', 'verify', 'restore', 'cleanup')]
  [string]$Action = 'full',
  [string]$BackupFile = '',
  [string]$BackupDir = 'D:\ZJYPH-backup',
  [int]$RetentionDays = 30,
  [switch]$ConfirmRestore,
  [string]$PgToolsBin = 'D:\ZJYPH-tools\pgsql\bin'
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $BackupDir 'logs'
$fullDir = Join-Path $BackupDir 'full'
New-Item -ItemType Directory -Force -Path $logDir, $fullDir | Out-Null

# ── 连接参数自动解析 ─────────────────────────────────────
# 若 PGHOST 等未设置（如计划任务场景），从生产 server\.env 的
# MIGRATE_DATABASE_URL（超级用户连接串）解析，备份须用超级用户。
if (-not $env:PGHOST) {
  $envFile = Join-Path $PSScriptRoot '..\.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^MIGRATE_DATABASE_URL=' } | Select-Object -First 1
    if ($line -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(\S+)') {
      $env:PGHOST = $Matches[3]
      $env:PGPORT = $Matches[4]
      $env:PGUSER = $Matches[1]
      $env:PGDATABASE = $Matches[5]
      $env:PGPASSWORD = $Matches[2]
    }
  }
}
if (-not $env:PGHOST -or -not $env:PGPASSWORD) {
  throw '无法确定数据库连接：请设置 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD，或确认生产 server\.env 已配置 MIGRATE_DATABASE_URL'
}

function Write-Log {
  param([string]$Msg)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
  Write-Host $line
  Add-Content -Path (Join-Path $logDir 'backup.log') -Value $line
}

function Get-AesKey {
  $keyStr = $env:ZJYPH_BACKUP_KEY
  if (-not $keyStr -or $keyStr.Length -lt 32) {
    throw 'ZJYPH_BACKUP_KEY 未设置或长度不足（要求 >= 32 字符），拒绝产出未加密备份'
  }
  # SHA-256 派生固定 32 字节密钥
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($keyStr))
}

function New-Encryptor {
  param([byte[]]$Key)
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $Key
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.GenerateIV()
  return $aes
}

function Invoke-PgDumpEncrypted {
  param([string]$Target)
  $pgDump = Join-Path $PgToolsBin 'pg_dump.exe'
  if (-not (Test-Path $pgDump)) { throw "pg_dump 不存在：$pgDump（请确认 D:\ZJYPH-tools 已部署）" }

  $key = Get-AesKey
  $aes = New-Encryptor $key

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $pgDump
  $psi.Arguments = "-Fc --no-owner --no-acl -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  if ($env:PGPASSWORD) { $psi.EnvironmentVariables['PGPASSWORD'] = $env:PGPASSWORD }

  $tmp = "$Target.partial"
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
    $fs = [System.IO.File]::Create($tmp)
    try {
      # 头部 16 字节写 IV，随后写入密文（明文不落盘）
      $fs.Write($aes.IV, 0, $aes.IV.Length)
      $cs = New-Object System.Security.Cryptography.CryptoStream(
        $fs,
        $aes.CreateEncryptor(),
        [System.Security.Cryptography.CryptoStreamMode]::Write)
      try { $p.StandardOutput.BaseStream.CopyTo($cs); $cs.FlushFinalBlock() }
      finally { $cs.Dispose() }
    }
    finally { $fs.Dispose() }

    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
      throw "pg_dump 失败（exit=$($p.ExitCode)）：$err"
    }
    # 原子化落地，避免定时任务与清理读到半成品
    Move-Item -Force -Path $tmp -Destination $Target
    # 权限收紧：移除继承，仅当前用户可读写（icacls 而非 .NET ACL，避免清空 ACL）
    & icacls $Target /inheritance:r /grant:r "$($env:USERNAME):F" 2>$null | Out-Null
    return (Get-Item $Target)
  }
  catch {
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
    throw
  }
}

function Invoke-DecryptStream {
  param([string]$Source)
  $key = Get-AesKey
  $fs = [System.IO.File]::OpenRead($Source)
  $iv = New-Object byte[] 16
  [void]$fs.Read($iv, 0, 16)
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $key; $aes.IV = $iv
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  return New-Object System.Security.Cryptography.CryptoStream(
    $fs,
    $aes.CreateDecryptor(),
    [System.Security.Cryptography.CryptoStreamMode]::Read)
}

function Invoke-Verify {
  param([string]$File)
  $pgRestore = Join-Path $PgToolsBin 'pg_restore.exe'
  if (-not (Test-Path $File)) { throw "备份文件不存在：$File" }

  # pg_restore --list 只读取归档头部的 TOC 即退出，不消费完整 stdin，
  # 故先解密到临时文件再交给 pg_restore 读取（用完即删）
  $plain = Join-Path $env:TEMP ("zjyph_verify_{0}.dump" -f ([guid]::NewGuid().ToString('N')))
  try {
    $cs = Invoke-DecryptStream $File
    try {
      $outFs = [System.IO.File]::Create($plain)
      try { $cs.CopyTo($outFs) }
      finally { $outFs.Dispose() }
    }
    finally { $cs.Dispose() }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $pgRestore
    $psi.Arguments = "--list `"$plain`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $out = $outTask.Result
    $err = $errTask.Result
    if ($p.ExitCode -ne 0) {
      throw "校验失败：无法解密或归档结构损坏（$err）"
    }
  }
  finally {
    if (Test-Path $plain) { Remove-Item $plain -Force -ErrorAction SilentlyContinue }
  }
  return $true
}

# ── 动作分发 ─────────────────────────────────────────────
switch ($Action) {
  'full' {
    $target = Join-Path $fullDir ("zjyph_prod_{0}.dump.enc" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
    Write-Log "开始全量备份 -> $target"
    $item = Invoke-PgDumpEncrypted $target
    Write-Log "全量备份完成：$($item.Name)（$([math]::Round($item.Length / 1MB, 2)) MB）"
    try {
      Invoke-Verify $target | Out-Null
      Write-Log '新备份校验通过'
    }
    catch {
      Write-Log "警告：新备份校验失败，请立即人工介入（$($_.Exception.Message)）"
    }
    Write-Log "清理 $RetentionDays 天前的旧备份"
    Get-ChildItem $fullDir -Filter '*.dump.enc' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item -Force
  }

  'verify' {
    if (-not $BackupFile) { throw 'verify 需要 -BackupFile 参数' }
    Invoke-Verify $BackupFile | Out-Null
    Write-Log "校验通过：$BackupFile 可解密且归档结构完整"
  }

  'restore' {
    if (-not $BackupFile) { throw 'restore 需要 -BackupFile 参数' }
    if (-not $ConfirmRestore) { throw '恢复会覆盖生产库现有数据。确认请加 -ConfirmRestore 参数' }
    Write-Host "将用 $BackupFile 覆盖 zjyph_prod，输入 yes 继续："
    if ((Read-Host) -ne 'yes') { Write-Log '恢复已取消'; exit 0 }

    Write-Log '先做恢复前保护性备份'
    $guard = Join-Path $fullDir ("zjyph_prod_{0}_prerestore.dump.enc" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
    Invoke-PgDumpEncrypted $guard | Out-Null
    Write-Log "保护性备份完成：$guard"

    $pgRestore = Join-Path $PgToolsBin 'pg_restore.exe'
    $cs = Invoke-DecryptStream $BackupFile
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $pgRestore
      $psi.Arguments = "--clean --if-exists --no-owner --no-acl -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE"
      $psi.UseShellExecute = $false
      $psi.RedirectStandardInput = $true
      $psi.RedirectStandardError = $true
      if ($env:PGPASSWORD) { $psi.EnvironmentVariables['PGPASSWORD'] = $env:PGPASSWORD }
      $p = [System.Diagnostics.Process]::Start($psi)
      # 异步读取 stderr，避免管道缓冲满造成死锁
      $errTask = $p.StandardError.ReadToEndAsync()
      try { $cs.CopyTo($p.StandardInput.BaseStream) }
      catch {
        # pg_restore 提前退出导致的管道关闭可接受：以退出码为准
        if (-not $p.HasExited) { throw }
      }
      $p.StandardInput.Close()
      $p.WaitForExit()
      $err = $errTask.Result
      if ($p.ExitCode -ne 0) { throw "pg_restore 失败（exit=$($p.ExitCode)）：$err" }
    }
    finally { $cs.Dispose() }
    Write-Log '恢复完成。请重新执行迁移（deploy 脚本）确认 schema 一致'
  }

  'cleanup' {
    Write-Log "清理 $RetentionDays 天前的旧备份"
    Get-ChildItem $fullDir -Filter '*.dump.enc' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item -Force
    Write-Log '清理完成'
  }
}
