# 文档归档索引 (Archive Index)

> 归档日期：**2026-07-20** | v3 迁移日期：**2026-07-21**

## 归档总述

2026-07-21 项目前端方案从 **v2（毛玻璃 + Ant Design 全量 + Framer Motion）**迁移至 **v3（纸质感 + Radix UI + Shadcn/ui + 纯 CSS 动画）**。文档体系同步重组为五分类结构：

- `CLAUDE.md`（根目录）— AI Agent 入口
- `docs/references/` — 引用：模块化快速参考（11 篇）
- `docs/plans/` — 方案：权威深度规范（6 篇）
- `docs/data-templates/` — 数据模版：示例 Excel 数据
- `docs/archive/`（本目录）— 历史文档：已废止的旧版本文档

v2 毛玻璃 UI 设计规范（`specs/UI设计规范.md`）已废止并移入本归档目录。

## 归档文件清单

| 序号 | 文件 | 归档原因 |
|---|---|---|
| 1 | `UI设计规范.md` | **v3 新增归档**——v2 毛玻璃 UI 设计（AntD 全量 + Framer Motion + backdrop-filter），已被 `docs/plans/frontend-design-proposal.md`（v3 纸质感方案）全面取代 |
| 2 | `legacydocs/_README.md` | 旧归档目录自述文件 |
| 3 | `legacydocs/ai规范和数据库规范.md` | 已被 CLAUDE.md + 数据模型规范 吸收 |
| 4 | `legacydocs/claude产出的prd.md` | 原始 PRD，13 条用户故事 + 4 UI mockup 已提取至整体方案v3 |
| 5 | `legacydocs/iOS毛玻璃UI设计规范.md` | 原始毛玻璃 UI 设计（v1 版），已被 UI设计规范 v2 吸收 |
| 6 | `legacydocs/iOS毛玻璃技术落地方案.md` | 原始毛玻璃技术方案（v1 版），已被 UI设计规范 v2 吸收 |
| 7 | `legacydocs/workbuddy system_design.md` | 原始系统设计，14 项 Q&A + 命名规范/API 错误码已提取 |
| 8 | `legacydocs/workbuddy产出prd.md` | 原始 PRD（8 模块版），已整合至整体方案v3 §二 |
| 9 | `legacydocs/整体方案-修订版.md` | 整体方案 v1（23 项修订），已被 v2 → v3 取代 |
| 10 | `legacydocs/整体方案-修订版v2.md` | 整体方案 v2（23+28=51 项修订），已被 v3 取代 |
| 11 | `legacydocs/整体方案可行性审查报告.md` | **历史参考**——第 1 轮 23 项修改的触发文档 |
| 12 | `legacydocs/整体方案-权限安全复审报告.md` | **历史参考**——第 2 轮 28 项修改的触发文档 |

## 已清理的历史文件

| 原路径 | 清理原因 |
|---|---|
| `通用规范文件/`（13 个文件） | 多语言/多框架通用模板，与本项目技术栈无关 |
| `class-diagram.mermaid` | 数据模型已从单表演变为 3 张事实表 + 15+ 领域表 |
| `sequence-diagram.mermaid` | 流程设计已从 SQLite/前端解析演变为 PostgreSQL/后端解析 + 8 层中间件 |
| `CHANGELOG.md` | 孤立文件——替代文档从未创建 |
| `页面风格变更规划.md` | 已合并至整体方案v3 + UI设计规范 |

## 现行文档导航

- **AI Agent 入口**：根目录 `CLAUDE.md`
- **项目概述**：`docs/README.md`
- **引用（11 篇）**：`docs/references/`
- **方案（6 篇）**：`docs/plans/`
- **数据模版**：`docs/data-templates/samples/`
