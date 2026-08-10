@echo off
rem ============================================================
rem  PostgreSQL 17 命令行工具安装脚本（ZJYPH 生产备份工具）
rem  安装到 D:\ZJYPH-tools\pgsql，装完自动清理临时服务与数据目录
rem  用法：右键本文件 -> 以管理员身份运行
rem  安装包路径可用参数覆盖：install-pg17-tools.bat "D:\下载\postgresql-17.x-windows-x64.exe"
rem ============================================================
setlocal

rem 安装包路径：优先取参数，缺省用默认下载位置（可按实际环境修改）
set "INSTALLER=%~1"
if "%INSTALLER%"=="" set "INSTALLER=C:\Users\85988\Downloads\postgresql-17.10-2-windows-x64.exe"
set PREFIX=D:\ZJYPH-tools\pgsql
set DATADIR=D:\ZJYPH-tools\pgdata-installer

rem 临时超级用户密码：每次运行随机生成（不进版本库），安装完成后提示修改
set "SUPER_PASSWORD=ZjyphTmp%RANDOM%%RANDOM%!"

if not exist "%INSTALLER%" (
  echo [错误] 找不到安装包：%INSTALLER%
  echo 请确认下载文件位置，或作为参数传入本脚本（见文件头说明）。
  pause
  exit /b 1
)

echo [1/4] 正在静默安装 PostgreSQL 17 到 %PREFIX% ...
"%INSTALLER%" --mode unattended --unattendedmodeui none --prefix "%PREFIX%" --superpassword "%SUPER_PASSWORD%" --serverport 5544 --servicename postgresql-zjyph-tmp --datadir "%DATADIR%" --disable-components stackbuilder
if errorlevel 1 (
  echo [错误] 安装失败（退出码 %errorlevel%），请检查上方输出。
  echo 若临时服务 postgresql-zjyph-tmp 已创建，请手动执行：
  echo   sc stop postgresql-zjyph-tmp ^&^& sc delete postgresql-zjyph-tmp
  echo 并修改其 postgres 超级用户密码（本次随机密码：%SUPER_PASSWORD%）
  pause
  exit /b 1
)
echo [2/4] 安装完成，清理临时 Windows 服务 ...
sc stop postgresql-zjyph-tmp >nul 2>&1
sc delete postgresql-zjyph-tmp >nul 2>&1

echo [3/4] 清理安装器创建的临时数据目录 ...
rmdir /s /q "%DATADIR%" >nul 2>&1

echo [4/4] 验证工具是否就绪 ...
if exist "%PREFIX%\bin\pg_dump.exe" (
  echo 安装成功：pg_dump / psql / pg_restore 已就绪
  "%PREFIX%\bin\pg_dump.exe" --version
) else (
  echo [警告] 未找到 pg_dump.exe，请检查安装输出。
)
pause
