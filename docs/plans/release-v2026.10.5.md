# v2026.10.5 更新后旧页面切换菜单报错修复发布记录

## 一、变更内容（缺陷修复，用户可感知）

### 现象

生产每次部署后，**部署前就已打开且未刷新的页面**，在切换到尚未加载过的菜单（如「财务指标」）时，会整页显示：

> 页面渲染出错
> 页面加载过程中出现异常，请重试；若反复出现请联系管理员。
> Failed to fetch dynamically imported module: http://192.168.1.201:8080/assets/xxx.js

点击「重试」无效，必须手动刷新整个页面（或关闭标签重开）才能恢复。

### 根因

1. 本项目所有路由页面均使用 `React.lazy()` 动态导入，产物文件名带内容哈希；部署后旧页面引用的是**已被替换的旧 chunk**。
2. `web/serve-static.cjs` 的 SPA 回退逻辑对**任何**不存在的路径都返回 `index.html`（HTTP 200 `text/html`）。于是缺失的 `/assets/xxx.js` 被当作 HTML 返回，浏览器把它当模块解析失败，抛出「Failed to fetch dynamically imported module」，真实原因（产物已失效）被掩盖。
3. `ErrorBoundary` 的「重试」只重置组件状态；而 `React.lazy` 会缓存失败的 Promise，重置后立刻再次抛出同一错误，因此重试必然无效。

### 修复

- **服务端**：`serve-static.cjs` 的 SPA 回退只用于**无扩展名路径**（前端路由）；缺失的带扩展名静态资源（如 `/assets/xxx.js`）返回 **404**，不再伪装成 `index.html`，`Cache-Control` 等行为不变。
- **客户端自动恢复**：新增 `web/src/lib/chunk-reload.ts`，在应用入口（`main.tsx`）监听 Vite 的 `vite:preloadError` 事件，产物加载失败时**整页刷新一次**（`sessionStorage` 记录时间戳，10 秒防循环，避免刷新风暴）。
- **客户端手动恢复**：`ErrorBoundary` 识别动态导入类错误后，「重试」改为**整页刷新**；非产物错误仍按原逻辑就地重渲染。

修复后，部署更新时旧页面首次切换菜单会自动刷新加载最新版本，用户无感知；即使自动刷新仍失败，点击「重试」也能重新加载页面。

## 二、影响文件

- `web/serve-static.cjs`（缺失静态资源返回 404，SPA 回退仅限无扩展名路径）
- `web/src/lib/chunk-reload.ts`（新增：错误识别 + 自动刷新，带防循环）
- `web/src/main.tsx`（注册自动刷新）
- `web/src/components/layout/error-boundary.tsx`（重试在产物失效时整页刷新）
- `web/serve-static.test.cjs`（新增 404 / SPA 回退集成测试）
- `web/src/lib/__tests__/chunk-reload.test.ts`（新增单测）
- `web/public/release-notes.json`（对外公告）

## 三、迁移与依赖

本次无数据库迁移，无依赖升级，无环境变量或构建配置变更。

## 四、发布方式

开发目录已通过 `npm run verify:web`（lint 0 错误、59 个测试文件全通过、serve-static 静态测试 6/6、`tsc -b` + `vite build` 成功）。随后创建带注释 tag `v2026.10.5`。生产只通过 `server/scripts/deploy-zjyph.ps1 -Tag v2026.10.5` 部署，由脚本完成备份校验、构建、迁移状态检查、重启和冒烟。

上一稳定版本为 v2026.10.4，回滚仍使用同一部署入口与该正式 tag。

## 五、运维提示

- 修复部署当天，**已经在浏览器中打开、尚未刷新的页面**仍可能命中一次旧行为；此时按 `Ctrl+F5` 强制刷新即可恢复。该提示仅针对部署当次的存量页面。
- 实际合并提交、备份文件、部署及验收结果记录在生产日志中，未完成的步骤不提前标记成功。