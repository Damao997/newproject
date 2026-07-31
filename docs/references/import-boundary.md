# 数据导入模块边界（数据管理 vs 往来分析）

> 本文档明确两个模块在数据导入链路上的职责划分与共享机制，避免功能重叠与口径分歧。

## 职责划分

| 模块 | 职责 |
|---|---|
| **数据管理**（`web/src/pages/data/`） | 主数据（公司/科目/公式）、导入模板下载、**全类型批次的集中生命周期管理**（列表/激活/归档/清除/错误查看），以及 经营（operating）/ 静态（static）/ 年度预算（budget）三类数据的上传通道 |
| **往来分析**（`web/src/pages/transactions/`） | 往来账龄报表（六大往来，dataType=`transaction`）的**就近导入入口**（多文件上传 + 预览 + 激活影响预告）、导入覆盖矩阵（公司×期间×类型 完整性视图与待激活提醒）、以及全部分析消费（总览/明细/账龄/内部往来/催收） |

要点：

- 往来导入**不并入**数据管理页的通用模板下拉（其解析器、多文件语义、Sheet 识别与通用模板完全不同），上传入口保留在往来分析页；
- 往来批次上传后与其他类型批次一样出现在数据管理页的批次列表中（类型标签「往来明细」），可在两处任一位置激活。

## 共享机制

- **批次模型**：所有类型共用 `ImportBatch`（`fileHash` 防重、`status` 结果态、`lifecycleStatus` 草稿→生效→归档/清除）。
- **激活接口**：统一 `POST /data/imports/:id/activate`，`ImportService.activate` 内按 `dataType` 分支执行合并策略——
  - operating/static：按期间合并替换；
  - transaction：按 (公司 × 期间 × 往来类型) 三元组合并替换；
  - budget：按财年整体替换；inventory：整体替换。
- **归档/清除**：统一 `POST /data/imports/:id/archive|purge`，权限 `data:import:archive|purge`。

## 前端缓存联动约定

批次的激活/归档/清除会改变分析数据，相关 mutation 的 `onSuccess` **必须失效以下 query 键**（见 `web/src/hooks/api-queries.ts` 的 `useActivateImport` / `useArchiveImport` / `usePurgeImport`）：

- `['data', 'imports']`（批次列表）
- `['data', 'cross-table']`、`['indicators']`（经营/静态分析）
- `['transactions']`（往来分析全部查询）

历史上往来页曾有独立的 `useActivateTransactionImport`，已合并入 `useActivateImport`（失效集为超集），往来页导入对话框与覆盖矩阵均复用该 hook。新增批次操作入口时禁止再造独立激活 hook。
