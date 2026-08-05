# legacydocs/ — 归档文档说明

> 本目录存放已废止或过期的设计文档。**AI Agent 开发时不应参考本目录中的任何文件。**
> 所有有效规范请查阅现行文档体系。

---

## 文档状态清单

| 文件 | 状态 | 废止原因 | 被什么取代 |
|------|------|----------|-----------|
| `../UI设计规范.md` | **v3 迁移废止** | v2 毛玻璃 UI（AntD 全量 + Framer Motion + backdrop-filter），被 v3 纸质感方案取代 | `docs/plans/frontend-design-proposal.md` |
| `整体方案-修订版v2.md` | **已升级为v3** | 整合为分层文档体系 | `docs/plans/整体方案v3.md` + 各子规范 |
| `整体方案-修订版.md` (v1) | **已废止** | v2新增二轮修订（权限安全28项），完全覆盖v1 | `docs/plans/整体方案v3.md` |
| `iOS毛玻璃UI设计规范.md` | **已合并** | 三份iOS文档合并 | `docs/archive/UI设计规范.md` v1.0 → 后再次升级为 v3 |
| `iOS毛玻璃技术落地方案.md` | **已合并** | 三份iOS文档合并 | `docs/archive/UI设计规范.md` v1.0 → 后再次升级为 v3 |
| `workbuddy system_design.md` | **已废止** | 原始架构设计，v2已大幅扩展 | `CLAUDE.md` + `docs/plans/数据模型规范.md` + `docs/plans/整体方案v3.md` |
| `workbuddy产出prd.md` | **已废止** | 原始PRD，8模块功能已完全融入v2 | `docs/plans/整体方案v3.md` §二 |
| `claude产出的prd.md` | **已废止** | 原始PRD，13条用户故事+4个UI布局已提取到v3 | `docs/plans/整体方案v3.md` §一~§二 |
| `ai规范和数据库规范.md` | **已废止** | 完全被吸收 | `CLAUDE.md` §四 + `docs/plans/数据模型规范.md` |
| `整体方案可行性审查报告.md` | **历史参考** | 首轮23项修订的触发文档，问题均已修复 | 可用于理解设计决策背景 |
| `整体方案-权限安全复审报告.md` | **历史参考** | 二轮28项修订的触发文档，问题均已修复 | 可用于理解设计决策背景 |

---

## 当前有效文档体系

```
d:\flies\pj3\
├── CLAUDE.md                          ← AI Agent 指令文件（唯一权威入口）
├── docs/
│   ├── README.md                      ← 项目概述
│   ├── references/                    ← 引用：模块化快速参考（12 篇）
│   │   ├── frontend.md               ← 前端开发速查（v3 纸质感版）
│   │   ├── backend.md                ← 后端技术栈 + API 规范
│   │   ├── db.md                     ← 数据库设计原则
│   │   ├── security.md               ← 安全加固 + 权限体系
│   │   ├── errorcode.md              ← 错误码 + 响应格式
│   │   ├── concurrency.md            ← 并发 / 幂等 / 事务
│   │   ├── observability.md          ← 日志 / traceId / 审计
│   │   ├── performance.md            ← 性能优化策略
│   │   ├── testing.md                ← 测试金字塔 + 覆盖率
│   │   ├── vcs.md                    ← Git 分支 / 提交规范
│   │   └── devops.md                 ← Docker / 部署 / 备份
│   ├── plans/                         ← 方案：权威深度规范（6 篇）
│   │   ├── frontend-design-proposal.md ← v3 前端设计方案（权威）
│   │   ├── 整体方案v3.md              ← 全局架构 + 模块关系 + API 清单
│   │   ├── 数据模型规范.md            ← 完整表结构 + 编码规则
│   │   ├── 安全与权限规范.md          ← 5 角色 × 8 模块权限矩阵
│   │   ├── AI模块规范.md              ← 双管道脱敏 + Prompt 防护
│   │   └── 部署运维规范.md            ← docker-compose + nginx + 备份
│   ├── data-templates/                ← 数据模版
│   │   └── samples/                  ← 示例 Excel 数据文件（4 个）
│   └── archive/                       ← 历史文档（本目录）
│       ├── index.md                  ← 归档索引
│       ├── UI设计规范.md              ← v2 毛玻璃规范（已废止）
│       └── legacydocs/               ← 原始 PRD/方案/审查报告
```

---

## 提取到新文档体系的精华内容

| 来源 | 提取内容 | 目标文档 |
|------|----------|----------|
| claude产出的prd.md | 13条用户故事 (US-01~US-13) | docs/plans/整体方案v3 §一 |
| claude产出的prd.md | 4个ASCII UI布局草图 | docs/plans/整体方案v3 §二 |
| workbuddy system_design.md | 14个设计决策问题 (Q1-Q14) | docs/plans/整体方案v3 §八 |
| workbuddy system_design.md | 项目文件/目录树 | docs/plans/数据模型规范 §九 |
| workbuddy system_design.md | 命名规范 + API错误码 | CLAUDE.md |
| workbuddy system_design.md | 6项核心技术难点 | docs/plans/整体方案v3 §八 |
| workbuddy system_design.md | 依赖包精确版本号 | docs/plans/部署运维规范 附录 |
| workbuddy system_design.md | 5阶段里程碑分组 | docs/plans/整体方案v3 §七 |
| workbuddy产出prd.md | 前端路由结构 | docs/plans/整体方案v3 §六 |
| 整体方案可行性审查报告.md | 容量规划数据 + 四维质量评分 + 5条架构建议 | docs/plans/整体方案v3 §八 + docs/plans/数据模型规范 §一 |
| 整体方案-权限安全复审报告.md | "三缺"框架 + 安全评分 + 边缘案例 + CSRF/哈希链/ESLint | docs/plans/安全与权限规范 |

---

*归档日期：2026-07-12 | 更新：2026-07-21（v3 迁移）*
