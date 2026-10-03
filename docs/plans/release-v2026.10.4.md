# v2026.10.4 公告历史版本查询发布记录

## 一、变更内容（新功能，用户可感知）

更新公告此前只在「服务器有新版本」或「当前版本公告未读」时自动弹窗，用户点「我知道了」后弹窗关闭，此后无法再查看任何公告，也看不到历史版本记录。

本次新增历史版本查询能力：

- 公告弹窗主视图新增显著入口「查看历史版本更新」（全宽入口行，标注版本总数）；
- 历史版本列表按发布时间倒序，逐条展示版本号、发布时间与更新摘要（`title`）；最新版带「最新」标记；
- 点击具体版本进入详情：展示该版本完整更新条目；非最新版明确标注「历史版本」徽标并提示「当前查看的是历史版本 vX，最新版本为 vY」；最新版标注「最新版本」；
- 顶栏用户菜单新增「更新公告」常驻入口，解决关闭弹窗后再无入口的问题；
- 新增 `sortReleasesDesc` 排序工具，历史列表倒序不依赖 `release-notes.json` 的人工维护顺序。

同一弹窗内以内部视图状态机（main / list / detail）切换，未新增路由、抽屉或依赖；响应式沿用现有弹窗门面（`DialogBody` 滚动、移动端自动收窄）。

本次不涉及后端接口与数据库，无口径变更。

## 二、影响文件

- `web/src/components/layout/version-notice.tsx`（视图状态机 + 入口 + 列表 + 历史标注）
- `web/src/components/layout/user-chip.tsx`（顶栏「更新公告」入口）
- `web/src/lib/app-version.ts`（新增 `sortReleasesDesc`）
- `web/src/stores/noticeStore.ts`（新增，公告弹窗共享开关）
- `web/src/lib/__tests__/app-version.test.ts`（新增排序用例）
- `web/src/components/layout/__tests__/version-notice.history.test.tsx`（新增回归测试）
- `web/public/release-notes.json`（对外公告）

## 三、迁移与依赖

本次无数据库迁移，无依赖升级，无环境变量或构建配置变更。

## 四、发布方式

开发目录已通过 `npm run verify:web`（lint 0 错误、58 个测试文件全通过、`tsc -b` + `vite build` 成功）。随后创建带注释 tag `v2026.10.4`。生产只通过 `server/scripts/deploy-zjyph.ps1 -Tag v2026.10.4` 部署，由脚本完成备份校验、构建、迁移状态检查、重启和冒烟。

上一稳定版本为 v2026.10.3，回滚仍使用同一部署入口与该正式 tag。

实际合并提交、备份文件、部署及验收结果记录在生产日志中，未完成的步骤不提前标记成功。