---
description: "安全重启 Streamlit 开发服务器：终止旧进程 → 清理缓存 → 语法校验 → 启动服务"
---

# Streamlit 开发服务器重启

一键完成 Streamlit 项目的开发服务器重启，避免手动拼接复杂的 Windows 命令。

## 使用方式

```
/streamlit-restart [项目目录] [端口号]
```

**参数：**
- `$1` 或 `$ARGUMENTS` 中的第一个路径参数：项目目录（默认 `E:\workspace\finance_app1`）
- 第二个参数（可选）：端口号（默认 `8888`）

**示例：**
```
/streamlit-restart
/streamlit-restart E:\workspace\finance_app1 8888
/streamlit-restart d:\workspace\finance_app 8501
```

## 执行步骤

依次执行以下 4 个阶段，任一阶段失败则停止并报告错误：

### 阶段 1：终止旧进程

```powershell
taskkill //F //IM python.exe 2>$null
Start-Sleep -Seconds 2
```

### 阶段 2：清理 Python 缓存

```powershell
Set-Location "<项目目录>"
Get-ChildItem -Path . -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
```

### 阶段 3：语法校验（可选但推荐）

对项目核心文件执行 `py_compile` 校验，确保没有语法错误再启动：

```powershell
Set-Location "<项目目录>"
# 自动检测项目中的 .py 文件，优先校验 app.py 和 services/、views/ 下的文件
python -c "
import py_compile, os, sys
files = ['app.py']
for d in ['services', 'views']:
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith('.py'):
                files.append(os.path.join(d, f))
ok = True
for f in files:
    if os.path.exists(f):
        try:
            py_compile.compile(f, doraise=True)
            print(f'  ✅ {f}')
        except py_compile.PyCompileError as e:
            print(f'  ❌ {f}: {e}')
            ok = False
if not ok:
    sys.exit(1)
print('所有文件校验通过')
"
```

如果校验失败，停止并提示用户修复语法错误，不启动服务。

### 阶段 4：启动 Streamlit 服务

```powershell
Set-Location "<项目目录>"
streamlit run app.py --server.port <端口号> --server.address 0.0.0.0 --server.fileWatcherType=poll 2>&1
```

**注意：** 使用 `--server.fileWatcherType=poll` 是因为 Windows 环境下 Streamlit 的默认文件监听器可能不触发自动重载。

## 退出条件

- 阶段 1-3 成功 → 阶段 4 在后台启动服务，输出访问地址 `http://localhost:<端口号>`
- 阶段 3 失败 → 输出语法错误详情，停止（不启动服务）
- 阶段 1 失败（无进程可杀）→ 静默继续后续阶段

## 适用场景

- 修改 Python 代码后需要重启服务查看效果
- Streamlit 服务卡死或端口被占用
- 清理旧的 `__pycache__` 后重新启动
- 首次启动开发环境

## 项目路径参考

| 项目 | 路径 | 默认端口 |
|------|------|----------|
| 新前端（React） | `D:\flies\pj3\web\` | 5173（npm run dev） |
| 旧后端（Streamlit） | `E:\workspace\finance_app1` | 8888 |
| 原始后端（Streamlit） | `d:\workspace\finance_app` | 8501 |
