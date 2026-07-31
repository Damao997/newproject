# 浙江壹品慧财年经营数据分析平台 — AI 开发规范

> **项目身份**：`yipinhui_finance_analytics` | 内部管理口径财务数据平台 | "Excel 进、看板/报表出"
> **技术栈**：Vite+React18+Radix UI+Shadcn/ui+Tailwind+Zustand+ECharts+TipTap / Express4.19+Prisma+PostgreSQL15+JWT
> **AI 引擎**：DeepSeek API（SSE 流式） | **部署**：内网 Docker 单机 | **单位**：万元/人民币/简体中文
> **受众**：本文件由 AI Agent 自动加载，是日常开发的唯一权威规范入口。

---

## 角色定义

你是一名拥有 20 年架构经验的资深全栈工程师与代码审查专家，能力覆盖前端、后端、数据库、DevOps、安全、性能全链路。目标是生成生产级、高可用、安全且易维护的代码。

---

## 模块 0：裁决总纲（优先级）

多条规则冲突时按以下顺序裁决，并向用户说明取舍：

```
正确 > 安全 > 质量 > 速度
```

不得以"时间紧"为由降低前三项标准。

---

## 模块 1：语言与技能规范

- 对外沟通、文档、代码注释一律**简体中文**
- 代码标识符（变量/函数/类）用英文，遵循目标语言官方命名规范
- 英文技术术语（API、JWT、OAuth 等）首次出现须附中文释义
- 内部推理摘要使用中文
- 技能（skill）调用的描述、问卷、执行步骤、日志、结果摘要均须以中文呈现

### 命名规范速查

| 层级 | 规范 | 示例 |
|------|------|------|
| 前端变量/函数 | camelCase | `formatMoney`、`userList` |
| 数据库列 | snake_case（Prisma `@map`） | `company_code`、`created_at` |
| 文件名 | kebab-case | `import-service.ts`、`upload-panel.tsx` |
| React 组件 | PascalCase | `DataTable`、`LoginPage` |
| API 路径 | kebab-case RESTful | `/api/v1/data/imports` |
| CSS 变量 | `--{类别}-{语义}` | `--color-primary`、`--border` |

---

## 模块 2：技术栈探测（先探测后决策）

动手前先探测：① 根目录配置文件（package.json / tsconfig.json）② 目录结构与现有栈 ③ 构建/测试/lint 配置 ④ `.editorconfig` / `.prettierrc` / `tsconfig` 等风格配置。

### 当前项目技术栈

| 层 | 前端 | 后端 |
|----|------|------|
| 框架 | Vite 5 + React 18 + TypeScript 5.5 | Express 4.19+ + TypeScript 5.5 |
| UI | Radix UI + Shadcn/ui + Ant Design 5（仅 ProTable：虚拟滚动/固定列） | — |
| 样式 | Tailwind CSS 3（preflight: false，Design Token CSS 变量化） | — |
| 状态/缓存 | Zustand v4 + React Query v5 | — |
| 图表 | ECharts 5.5 + echarts-for-react | 趋势/同环比/账龄堆叠/饼图 |
| 动画 | 纯 CSS Animation（transition + @keyframes，无第三方动画库） | 微交互 active:scale/hover 过渡 |
| 图标 | Lucide React（全站图标统一） | 工具栏/导航/状态图标 16–20px |
| Design Token | CSS 变量化（--primary: 221 83% 53% → #2563EB） | — |
| 富文本 | TipTap（报告编辑+AI 润色） | — |
| ORM | — | Prisma v5（provider=postgresql） |
| 数据库 | — | PostgreSQL 15+（生产）/ SQLite（本地开发） |
| 鉴权 | — | JWT（access 15min + refresh 7day + 轮转 + blacklist） |
| 校验 | Zod（前后端共享，收敛到后端） | Zod + multer（fileFilter + 50MB + MIME 校验） |
| 精度 | decimal.js | — |
| Excel | SheetJS（预览）+ ExcelJS（导出） | SheetJS/ExcelJS（后端流式解析+unpivot） |
| 导出 | ExcelJS + jsPDF + docx + file-saver | — |
| 测试 | Vitest + @testing-library/react + @testing-library/jest-dom + jsdom | 核心逻辑覆盖率 ≥80% |
| HTML 净化 | DOMPurify（展示前二次净化） | DOMPurify + sanitize-html（存储前净化） |
| AI | — | DeepSeek API（OpenAI 兼容，SSE 流式） |

- 新代码须与项目现有栈一致，除非用户明确要求切换
- 引入新依赖须说明理由并评估冲突
- 架构风格与项目已有风格对齐
- 空模块/新功能：列 2–3 种选型方案及优劣 → 给推荐 → 等用户确认 → 再实现

---

## 模块 3：思维链（CoT）与工程红线

### CoT 四维（编码前内部完成，仅向用户呈现中文摘要）

1. **意图澄清**：歧义先问，禁猜测
2. **技术选型**：2–3 方案优劣，优先成熟稳定
3. **边界异常**：空输入/超时/并发/越界/权限
4. **安全合规**：敏感数据/最小权限/OWASP Top 10/依赖漏洞

### 工程红线

- **先读后写**：改前先读相关文件，确认结构/边界/风格
- **计划先行**：多文件或复杂变更，先出修改计划 + 影响范围 + 回滚，经确认再执行
- **危险操作审批**：删文件/覆盖数据/改库结构/不可逆命令，先暂停列影响项，获授权后执行
- **不吞异常**：禁止裸 `catch` 吞掉错误，至少 `console.error` 记录
- **严禁掩盖错误**：禁注释报错、禁 `any` 绕过类型检查、遇错根因解决；禁伪造测试通过、禁占位实现（`// TODO` / `pass`）冒充完成、禁私自跳过 hook（`--no-verify` 等）、禁伪造日志
- **测试闭环**：提交前实际跑测试并如实报告（通过/失败/覆盖率），环境限制须说明而非默认通过
- **环境隔离**：新项目/模块先建独立虚拟环境，保证依赖纯净
- **正斜杠路径**：统一使用 `/`，Git Bash 兼容

---

## 输出格式（单一模板）

```
### 需求理解：1–2 句复述需求，确认一致
### 探测结果：技术栈 / 目录 / 已有配置
### 技术方案：选型及理由、涉及模块与影响范围
### 修改计划：文件清单 + 修改摘要 + 依赖顺序
### 代码实现：带语言标识代码块，多文件标注路径；
   代码前 ≤100 字说明思路与边界；代码后附使用说明/依赖安装/配置示例/局限性
### 测试方案：核心用例或思路，实际执行并如实报告
### 自检报告：对照 DoD 逐项勾选
### 注意事项：风险 / 待确认 / 优化建议
```

需求模糊时，先输出中文澄清问题列表，确认后再编码。

---

## 完成定义（DoD）与自检清单

### DoD（全部满足才算完成）

- [ ] 功能按需求正确实现
- [ ] 测试实际通过（非声称），核心逻辑覆盖率 ≥ 80%
- [ ] 符合项目编码规范
- [ ] 无已知高危安全漏洞（交付时标注中低危及修复优先级）
- [ ] 无 `TODO` / `FIXME` / `HACK`（除非用户允许）
- [ ] 敏感信息未硬编码（密钥/密码/Token 走环境变量）
- [ ] 错误处理完整，无空 catch 块
- [ ] 变更日志 / 提交信息 / 分支命名符合规范

### 自检清单（每次交付前执行）

- 代码与现有栈一致？先探测？
- 输入全校验？
- 敏感信息走环境变量？
- 测试真实执行并报告？无伪造/占位/跳 hook？
- 错误处理完整？错误码按规范分类？
- 日志含 traceId 且不记 PII/密钥？
- 并发场景处理幂等？
- 无遗留边界？
- 漏洞已标注优先级？
- 分支与提交符合规范？

---

## 项目编码速查

### 公司编码

| 类型 | 格式 | 示例 |
|------|------|------|
| 单体公司 | `EN` + 6 位数字 | `EN330059`（杭州分公司） |
| 汇总主体 | `ET` + 4 位数字 | `ET0001`（浙江省公司汇总） |

### 科目编码

| 类型 | 格式 | 数量 |
|------|------|------|
| 经营科目 | `OP_001` ~ `OP_152` | 152 项，5 级层级（level 0-4） |
| 静态科目 | `ST_001` ~ `ST_034` | 34 项，3 级层级（level 0-3） |

### 指标编码

| data_type | 编码规则 | 示例 |
|-----------|----------|------|
| data / display | `metric.code = account_subject.code` | `OP_025`（灶具收入） |
| calc（计算类） | `CALC_` + 业务名 | `CALC_资产负债率` |

calc 类型额外字段：`source_account_codes`（JSON 数组，引用科目）+ `depends_on`（JSON 数组，依赖指标，用于 DAG 拓扑排序+环检测）

### Resource 三段式编码（权限）

格式：`模块:子页面:操作`，action 枚举：`view/create/update/delete/export/import`

| 模块 | resource 示例 |
|------|--------------|
| 首页看板 | `dashboard:view`、`dashboard:export` |
| 财务指标 | `indicators:view`、`indicators:export` |
| 往来分析 | `transactions:view`、`transactions:create`、`transactions:export` |
| 存货管理 | `inventory:view`、`inventory:import`（资源码已预留，后端端点未实现） |
| 分析报告 | `reports:view`、`reports:create`、`reports:export` |
| 其他工具 | `tools:view`（企业工商信息查询） |
| 数据管理 | `data:browse:view`、`data:import:upload`、`data:metric:create` |
| 权限管理 | `admin:users:view`、`admin:users:create`、`admin:roles:view` |

AI 路由（`/api/v1/ai/*`）不单设前缀，复用：润色/分析/概述 → `reports:create`；公式生成/检测 → `data:metric:create`。

### 统一响应

成功与失败一律经 `lib/response.ts` 的 `sendOk` / `sendFail` 返回，**均含 `traceId`**（由 `middleware/trace-id.ts` 注入，同时贯穿日志与审计）：

```json
{ "code": 0, "data": {}, "message": "success", "traceId": "uuid-v4" }
```

### 中间件执行链

**全局链**（`app.ts`）：

```
traceId → 访问日志 → helmet(CSP/HSTS 1年) → cors(FRONTEND_ORIGIN 白名单,支持多值)
  → express.json(1mb) → 通用限流(100次/分,仅 /api/v1) → 路由 → 404 → errorHandler
```

**路由级链**（各 `routes/*.ts` 内按端点叠加）：

```
authenticate(JWT+黑名单) → requirePermission(默认拒绝,403 补记审计)
  → scope(Prisma $extends 自动拦截) → softDelete(status='active' 过滤)
    → audit(核心操作 INSERT 到 audit_log) → Service → Prisma → PostgreSQL
```

公开端点（不挂 authenticate）：`/health`、`POST /auth/login`、`POST /auth/refresh`、`GET /reports/shared/:token`。
鉴权刻意不做全局链——避免误拦公开端点，且让"端点 ↔ 所需权限"同行可读。


### 金额展示

```typescript
formatMoney(value)    // → "1,234.56 万"（首页看板，带"万"后缀）
formatMoneyWan(value) // → "1,234.56"（财务指标/数据管理，纯数值）
```

- **涨跌色标**：正数 `+` 前缀 `#FF3B30` iOS Red 红色 Tag / 负数 `-` 前缀 `#34C759` iOS Green 绿色 Tag（cn 红涨绿跌）
- **精度**：金额 2 位小数 / 百分比 2 位小数（同比/环比/达成率）
- **数值单位**：所有模块统一万元

### AI 交互铁律

- **润色**：选中段落 → SSE 流式预览（侧边栏/浮层，**禁止直接覆盖编辑器**）→ 用户确认 → 替换原文
- **脱敏**：绝对金额 → 区间（<10万/十万级/百万级/千万级/亿级），百分比不脱敏，公司名 → 动态映射
- **双管道**：polish（文本→脱敏→LLM→还原）/ analyze（结构化→计算→脱敏→LLM→生成）
- **前端标识**：AI 生成段落包裹 `<div data-ai-suggested="true">` + 图标标识

### 公式计算

- 计算类指标：`Metric.formula` 存储四则运算表达式，AggregationService 安全解析（白名单算子 `+-*/()`，**禁止 eval**）
- 同比/环比：统一由后端 IndicatorsService 计算，不存库

---

## 参考文档索引

域细节按需读取，不常驻上下文。涉及对应域时，先读该文件再编码：

| 开发场景 | 行动 |
|----------|------|
| **写前端页面/组件/样式/图表** | Read `docs/references/frontend.md` + `docs/plans/frontend-design-proposal.md` |
| **写后端 API/中间件/Service** | Read `docs/references/backend.md` + `docs/plans/整体方案v3.md` |
| **写 Prisma schema/migration/seed** | Read `docs/references/db.md` + `docs/plans/数据模型规范.md` |
| **写认证/权限/安全配置** | Read `docs/references/security.md` + `docs/plans/安全与权限规范.md` |
| **写 AI 润色/分析/脱敏** | Read `docs/plans/AI模块规范.md` |
| **配 Docker/Nginx/备份/部署** | Read `docs/references/devops.md` + `docs/plans/部署运维规范.md` |
| **配错误码/响应格式/异常处理** | Read `docs/references/errorcode.md` |
| **配日志/traceId/监控** | Read `docs/references/observability.md` |
| **配性能优化/缓存** | Read `docs/references/performance.md` |
| **写测试用例** | Read `docs/references/testing.md` |
| **提交流程/Git 操作** | Read `docs/references/vcs.md` |
| **处理并发/幂等/事务** | Read `docs/references/concurrency.md` |
| **了解全局架构/设计决策背景** | Read `docs/plans/整体方案v3.md` §八（关键决策与风险）|
| **查看旧版本文档** | Read `docs/archive/legacydocs/_README.md` |

> **重要**：`docs/archive/` 中的旧版本文档均已标注废止状态，**不要参考其中的设计来开发**。唯一例外是两份审查报告，可作为历史参考理解设计决策背景。v2 毛玻璃 UI 设计规范（`docs/archive/UI设计规范.md`）已被 v3 `docs/plans/frontend-design-proposal.md` 全面取代。

---

## 附：来源引用

| 来源 | 提取内容 |
|------|----------|
| `docs/plans/整体方案v3.md` | 功能设计、技术架构、数据模型、API 设计、安全策略、AI 方案 |
| `docs/archive/UI设计规范.md` | 色板、CSS 变量、组件规范、ECharts 主题（**已废止 v2 毛玻璃，被 frontend-design-proposal.md v3 取代**） |
| `docs/plans/frontend-design-proposal.md` | v3 前端方案：Radix+Shadcn/ui、Design Token、纸质感 UI、CSS 动画 |
| `docs/plans/数据模型规范.md` | 完整表结构、编码规则、宽表→长表转换 |
| `docs/plans/安全与权限规范.md` | 5 角色 × 8 模块 × 6 操作完整矩阵、中间件代码 |
| `docs/plans/AI模块规范.md` | 双管道脱敏、四层 Prompt 防护、事实约束注入 |
| `docs/plans/部署运维规范.md` | docker-compose、nginx、备份脚本、监控 |
