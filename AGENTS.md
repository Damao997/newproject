# ZJYPH 工程约束入口

开始工作前必须完整阅读 `CLAUDE.md`；涉及具体领域时，再读取其中“参考文档索引”指向的规范。

生产安全规则：

- 开发工作区与生产工作区必须分离。推荐开发目录 `D:\ZJYPHFA-dev`，生产目录 `D:\ZJYPHFA`。
- 生产只允许检出 `main` 上的正式 tag；禁止在生产目录开发、提交、stash（尤其是 `stash -u/-a`）、运行测试或执行 `prisma migrate dev`/seed。
- 正式部署统一运行 `server/scripts/deploy-zjyph.ps1 -Tag <版本>`，不得手工覆盖 `dist`。
- `data/`、`backup/`、`tools/`、`*.dump`、真实 `.env` 和运维面板真实配置属于本机运行资产，严禁提交。
- 任何数据库迁移、恢复、删除或服务重启前，必须先说明影响并完成备份/回滚检查。

提交前在开发工作区执行 `npm run verify`。所有对外说明、注释和文档使用简体中文。
