# Soybean Admin 并行接入试点

- 状态：开发工作区试点已实现，未提交、未部署
- 日期：2026-10-24
- 范围：并行新前端 + 旧首页入口；不替换旧前端，不连真实数据库

## 决策与边界

用户选择“并行新前端，在项目首页增加切换新风格过渡”。一期只验证：

1. 新前端外壳与品牌基线；
2. 复用旧版账号会话与权限；
3. 关键指标预置视图；
4. 品类配置映射规则；
5. 旧版首页入口与返回旧版。

一期不包含：其余 7 个预置视图、其余 4 类映射、报告编辑器、导入流程、四主题完整对齐、生产部署。八个预置和五类规则没有被删除或下线。

仅持有映射权限、没有 `dashboard:view` 的账号，新版暂时没有独立入口，继续使用旧版；旧首页入口也只对能看到首页的账号显示。

## 架构

- 新前端目录：`web-next/`，基于 Soybean Admin 2.3（Vue 3 + Naive UI + UnoCSS，MIT）。
- 访问路径：同源 `/next/`。开发期由旧 Vite 将 `/next` 转发到 `127.0.0.1:9527`；新版自身将 `/api` 转发到 `server/.env` 的 `PORT`。
- 生产静态挂载尚未实现，部署前必须补 `web/serve-static.cjs` 的 `/next` 映射与 SPA 回退。
- 旧前端保持默认入口；仅新增 [next-ui-entry.tsx](../../web/src/components/layout/next-ui-entry.tsx) 和 [dashboard/index.tsx](../../web/src/pages/dashboard/index.tsx) 的挂载点。
- 新版登录页不维护独立账号，跳转旧版 `/login`；登录后通过同源 `auth-storage` 读取会话。

## 会话与权限

- [session.ts](../../web-next/src/service/session.ts) 读取旧版 Zustand `auth-storage`，加入旧版已有的 `auth-refresh` BroadcastChannel，刷新后的 access/refresh token 写回同一存储，不通过 URL 传递令牌。
- [client.ts](../../web-next/src/service/client.ts) 统一附加 Bearer token；HTTP 401 时单飞刷新并重试一次，刷新失败回到旧版登录。
- [auth store](../../web-next/src/store/modules/auth/index.ts) 将 `user.permissions` 映射为 Soybean 路由 roles 与 buttons；路由 meta 使用 `dashboard:view`，映射按钮额外要求 `data:browse:view`。
- 新版 403 页提供“返回旧版”和“返回首页”，明确说明旧版权限不被放宽。

## 试点接口

- 关键指标：`GET /dashboard/analysis/key-metrics`，参数为可选 `period`、`companyCode`。
- 品类配置：`GET /data/product-categories`；编辑保存 `PATCH /data/product-categories/:id`。
- 只读字段：品类编码、规则生效范围说明、当前账号主体。
- 其他预置与规则只显示迁移中提示，不伪造接口或结果。

## 已验证

- `web-next`：`pnpm typecheck` 通过；`pnpm build` 通过。
- 隔离 Edge + 模拟接口：旧会话进入新版、关键指标表渲染、品类编辑 PATCH、只读账号隐藏映射、390px 无页面横向溢出、无页面错误。
- 无 `dashboard:view` 账号跳转 `/next/403`，页面显示“403 · 无权限”和返回旧版入口。
- 旧前端：首页看板相关 35 个测试通过；改动 3 文件 oxlint 0 错误；`npm run build --prefix web` 退出码 0。
- 未验证：真实 API、真实数据库、旧前端浏览器内入口点击、跨标签刷新轮转、生产静态挂载、后续模块等价性。

## 回退

1. 移除旧首页 `NextUiEntry` 挂载与组件；
2. 移除旧 Vite `/next` 代理；
3. 不部署 `/next` 静态目录；
4. 删除或保留 `web-next/` 不影响旧前端运行。

## 下一步

1. 在已授权测试库验证登录、关键指标与品类保存真实接口；
2. 补生产 `serve-static` 的 `/next` 挂载与测试；
3. 增加跨标签刷新与退出同步验证；
4. 按模块迁移其余预置/规则，逐字段与旧页面做等价验收；
5. 再决定四主题与第三、四层视觉/动效在新版的落地方式。

## 许可

Soybean Admin 为 MIT 许可。保留上游 `LICENSE` 与版权声明；自定义改动集中在新版业务视图、会话桥和接口适配层，避免大范围改写上游 packages。
