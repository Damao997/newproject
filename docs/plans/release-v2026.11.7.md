# v2026.11.7 修复深层路由刷新后停留在加载页

## 现象

生产环境在 `/data/import`、`/admin/users`、`/reports/...` 等二级及更深路由按 F5 刷新后，页面只显示首屏骨架和破图 Logo，React 未启动；根路径 `/` 正常。

## 根因

企业 AI 中台接入改为 `base: './'` 后，内部生产构建的 `index.html` 使用 `./assets/...` 相对资源。刷新 `/data/import` 时浏览器按当前目录解析为 `/data/assets/...`，JS/CSS 全部 404；内部 `serve-static.cjs` 未注入根路径 `<base>`，而中台 `portal-web.ts` 已注入 `/<slug>/` 前缀。

## 修复

- `web/scripts/build-prod.mjs` 在内部生产构建完成后向 `index.html` 注入 `<base href="/">`。
- 新增 `web/scripts/index-html.mjs` 与单测，保证注入、替换和幂等行为。
- `production-smoke-zjyph.ps1` 增加 `/data/import` 深层路由刷新检查。
- 中台 Docker 构建不经过 `build:prod`，仍由 `portal-web.ts` 注入 `/<slug>/` 前缀。

## 发布门禁

- 因该缺陷为生产 P0，按 `生产部署发布流程.md` 走 `hotfix/*` → `main`，CI 通过后打 tag，并同步回 `develop`。
- 合并提交 SHA：部署后回填。
- 正式 tag：`v2026.11.7`。
- 数据库迁移：无。

## 验收与回滚

- 验收：生产根路径、深层路由刷新、资源 200、冒烟与巡检均通过后回填。
- 回滚：`server\scripts\deploy-zjyph.ps1 -Tag v2026.11.6`；该版本会重新引入本缺陷。
