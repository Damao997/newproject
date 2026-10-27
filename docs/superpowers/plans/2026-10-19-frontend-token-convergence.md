# 前端设计 Token 收敛与死样式修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全站设计参数从"圆润舒展"收敛到"中间档"（卡片圆角 16px、控件圆角 8px、卡片内距 20px、表头 40px、阴影更锐利），并修复审计日志页 3 处死 CSS 变量引用。

**Architecture:** 单点收敛。圆角与阴影的源头是 `web/src/lib/app-themes.json`（4 套配方）经 `web/src/lib/theme-css.ts` 生成 CSS 变量、由 Vite 注入；因此改 token 即全站生效。`surfaces.css` 中不跟随 token 的硬编码圆角需同批对齐；Tailwind 的 `rounded-xl` / `rounded-2xl` 通过覆写映射到语义令牌，消除收敛后产生的分叉。

**Tech Stack:** React 19 + TypeScript + Vite 5 + Tailwind CSS 3 + Vitest 2

**Spec:** `docs/superpowers/specs/2026-10-19-frontend-polish-and-capabilities-design.md`（本计划实现其 §4 节 2 与节 6）

## Global Constraints

- 实施目录：`D:\ZJYPHFA-dev`（开发工作区）。生产目录 `D:\ZJYPHFA` 为 sparse-checkout，**禁止任何写入、提交、运行测试**。
- 开发工作区存在 52 个与本计划无关的在途改动（即席分析模块）。**本计划只允许改动下列明确列出的文件**；`git add` 必须逐文件指定，禁止 `git add -A` / `git add .`。
- 对外说明、注释、提交信息一律使用简体中文；代码标识符用英文。
- 提交前在 `D:\ZJYPHFA-dev` 运行 `npm run verify`。
- 提交信息格式：`<type>(<scope>): <中文描述>`。
- 手机端（`max-width: 767px`）卡片左右内边距 16px 保持不变（`web/src/styles/surfaces.css:108` 用 `!important` 覆盖）。
- 全部改动为视觉参数，不改任何业务逻辑、接口、路由与权限。

## File Structure

| 文件 | 职责 | 本计划改动 |
| --- | --- | --- |
| `web/src/lib/app-themes.json` | 4 套主题配方的唯一色板与几何来源 | Task 1：8 个数字 |
| `web/src/lib/theme-css.ts` | 由配方生成 CSS 变量，Vite 注入 | Task 2：浮层阴影值 |
| `web/tailwind.config.js` | Tailwind 令牌映射 | Task 1：`borderRadius`；Task 2：`boxShadow` |
| `web/src/lib/__tests__/theme-css.test.ts` | 主题令牌回归测试 | Task 1 创建，Task 2 追加 |
| `web/src/lib/__tests__/css-vars.test.ts` | CSS 变量引用完整性测试 | Task 5 创建 |
| `web/src/components/ui/card.tsx` | 卡片结构基元 | Task 3：内距 |
| `web/src/components/data-table/data-table.tsx` | 表格密度档位 | Task 3：表头与单元格内距 |
| `web/src/styles/surfaces.css` | 组件视觉归属层 | Task 4：6 处圆角 |
| `web/src/pages/admin/audit-logs.tsx` | 审计日志页 | Task 5：3 处变量名 |
| `DESIGN.md` | 设计契约（源） | Task 6：条款同步 |

---

### Task 1: 圆角 token 收敛 + 消除双轨分叉

**Files:**
- Modify: `web/src/lib/app-themes.json`（4 个主题的 `radius` 与 `controlRadius`）
- Modify: `web/tailwind.config.js:195-205`（`borderRadius`）
- Test: `web/src/lib/__tests__/theme-css.test.ts`（创建）

**Interfaces:**
- Consumes: `buildThemeCss(): string`（已存在于 `web/src/lib/theme-css.ts:50`，返回 4 段 `:root[data-sidebar='<style>']{...}` 拼接的 CSS 文本）
- Produces: 生成的 CSS 中包含 `--radius:8px` 与 `--radius-card:16px`，各 4 次（每套主题一次）

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/__tests__/theme-css.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildThemeCss } from '../theme-css'

describe('主题圆角令牌（中间档收敛）', () => {
  it('四套主题的控件圆角为 8px、卡片圆角为 16px', () => {
    const css = buildThemeCss()
    expect(css.match(/--radius:8px/g) ?? []).toHaveLength(4)
    expect(css.match(/--radius-card:16px/g) ?? []).toHaveLength(4)
  })

  it('不再残留收敛前的 12px / 24px 圆角', () => {
    const css = buildThemeCss()
    expect(css).not.toContain('--radius:12px')
    expect(css).not.toContain('--radius-card:24px')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/theme-css.test.ts`
Expected: FAIL —— 断言 `--radius:8px` 期望 4 次、实际 0 次（当前生成的是 `--radius:12px`）

- [ ] **Step 3: 修改 4 套主题的圆角字段**

在 `web/src/lib/app-themes.json` 中，对 `light` / `gradient` / `dark` / `antd` 四个顶级键，各改两个字段：

```json
"radius": 24        →   "radius": 16
"controlRadius": 12 →   "controlRadius": 8
```

共 8 处。不要改动同文件中的任何颜色值、`series`、`metricSurfaces`、`metricInks`。

- [ ] **Step 4: 覆写 Tailwind 的 xl / 2xl 映射**

在 `web/tailwind.config.js` 的 `theme.extend.borderRadius`（约 195-205 行）中，插入两行：

```js
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // 收敛后 --radius 变为 8px，原生 xl(12px) 会与 lg 分叉；映射到令牌保持同源
        xl: "var(--radius)",
        "2xl": "var(--radius-card)",
        card: "var(--radius-card)",
        pill: "9999px",
        // antd 镜像：4 / 6 / 8（与 globals.css --antd-radius-{sm,md,lg} 一一对应）
        "antd-sm": "var(--antd-radius-sm)",
        "antd-md": "var(--antd-radius-md)",
        "antd-lg": "var(--antd-radius-lg)",
      },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/theme-css.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 6: 提交**

```bash
cd /d/ZJYPHFA-dev
git add web/src/lib/app-themes.json web/tailwind.config.js web/src/lib/__tests__/theme-css.test.ts
git commit -m "feat(theme): 圆角令牌收敛为控件 8px / 卡片 16px，并消除 xl 分叉"
```

---

### Task 2: 浮层阴影收敛

**Files:**
- Modify: `web/tailwind.config.js:180-191`（`boxShadow`）
- Modify: `web/src/lib/theme-css.ts:47`（`--antd-shadow-1/2/3`）
- Test: `web/src/lib/__tests__/theme-css.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 创建的测试文件；`buildThemeCss(): string`
- Produces: 生成 CSS 中 `--antd-shadow-2` 为 `0 8px 24px rgb(0 0 0 / .09)`（浅色主题）

- [ ] **Step 1: 追加失败测试**

在 `web/src/lib/__tests__/theme-css.test.ts` 末尾追加：

```ts
describe('浮层阴影收敛', () => {
  it('浅色主题的二级浮层阴影收敛为 8px/24px', () => {
    const css = buildThemeCss()
    expect(css).toContain('--antd-shadow-2:0 8px 24px rgb(0 0 0 / .09)')
    expect(css).not.toContain('--antd-shadow-2:0 12px 36px')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/theme-css.test.ts`
Expected: FAIL —— 当前为 `--antd-shadow-2:0 12px 36px`

- [ ] **Step 3: 改 Tailwind boxShadow**

将 `web/tailwind.config.js` 的 `theme.extend.boxShadow`（第 180-191 行）整体替换为：

```js
      boxShadow: {
        // 中间档收敛：扩散半径与不透明度各降一档，层次更锐利
        sm: "0 1px 2px 0 rgb(0 21 41 / 0.05)",
        DEFAULT: "0 1px 2px 0 rgb(0 21 41 / 0.06)",
        md: "0 3px 4px -1px rgb(0 21 41 / 0.07), 0 1px 3px -1px rgb(0 21 41 / 0.05)",
        lg: "0 8px 16px -6px rgb(0 21 41 / 0.10)",
        xl: "0 16px 32px -10px rgb(0 21 41 / 0.15)",
        // antd 镜像：与 --antd-shadow-{1,2,3} 一一对应，用于 Card / Modal / Drawer
        "antd-1": "var(--antd-shadow-1)",
        "antd-2": "var(--antd-shadow-2)",
        "antd-3": "var(--antd-shadow-3)",
      },
```

- [ ] **Step 4: 改 theme-css.ts 的浮层阴影**

在 `web/src/lib/theme-css.ts` 第 47 行的模板串中，第 47 行末尾部分按下面做一次精确替换。

替换前，在该行中定位此片段：

```
--antd-shadow-1:${p.dark ? 'none' : '0 4px 20px rgb(44 60 95 / .035)'};--antd-shadow-2:0 12px 36px rgb(0 0 0 / ${p.dark ? '.32' : '.1'});--antd-shadow-3:0 18px 54px rgb(0 0 0 / .16);
```

替换为：

```
--antd-shadow-1:${p.dark ? 'none' : '0 3px 14px rgb(44 60 95 / .03)'};--antd-shadow-2:0 8px 24px rgb(0 0 0 / ${p.dark ? '.28' : '.09'});--antd-shadow-3:0 12px 36px rgb(0 0 0 / .14);
```

同一行其余片段（`color-scheme`、`--radius`、`--radius-card`、`--font-heading`、`--antd-radius-*`、`--scrollbar-*`）原样保留。

- [ ] **Step 5: 运行确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/theme-css.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```bash
cd /d/ZJYPHFA-dev
git add web/tailwind.config.js web/src/lib/theme-css.ts web/src/lib/__tests__/theme-css.test.ts
git commit -m "feat(theme): 收敛浮层与卡片阴影，层次更锐利"
```

---

### Task 3: 卡片内距与表头高度收敛

**Files:**
- Modify: `web/src/components/ui/card.tsx`（3 处 `p-6`）
- Modify: `web/src/components/data-table/data-table.tsx:106-108`（`densityClass.default`）

**Interfaces:**
- Consumes: 无（独立）
- Produces: 卡片桌面内距 20px、表格默认档表头 40px、单元格纵向内距 14px；`densityClass` 的 `dense` / `compact` 档不变

- [ ] **Step 1: 改卡片基元内距**

在 `web/src/components/ui/card.tsx` 中改 3 处类名：

```tsx
// CardHeader（第 26 行）
"card-header flex flex-col space-y-1.5 p-6"      →  "card-header flex flex-col space-y-1.5 p-5"

// CardContent（第 63 行）
"card-content p-6 pt-0"                          →  "card-content p-5 pt-0"

// CardFooter（第 73 行）
"card-footer flex items-center p-6 pt-0"         →  "card-footer flex items-center p-5 pt-0"
```

`p-5` 为 20px。手机端左右内距由 `web/src/styles/surfaces.css:108` 的 `!important` 规则固定为 16px，不受影响。

- [ ] **Step 2: 改表格密度档位**

在 `web/src/components/data-table/data-table.tsx` 的 `densityClass`（约 106-110 行）中，只改 `default` 一行：

```ts
const densityClass: Record<TableDensity, { head: string; cell: string }> = {
  default: { head: 'h-10', cell: 'px-4 py-3.5' },
  dense: { head: 'h-8', cell: 'px-4 py-1.5' },
  compact: { head: 'h-8', cell: 'px-3 py-2' },
}
```

`h-10` = 40px（原 44px）；`py-3.5` = 14px（原 `p-4` 的 16px）。同步更新第 42 行注释中的 `default（表头 h-11 / 单元格 p-4）` 为 `default（表头 h-10 / 单元格 px-4 py-3.5）`。

- [ ] **Step 3: 类型与单测校验**

Run: `cd web && npx tsc -b --noEmit && npm run test`
Expected: 类型检查通过；既有测试全部通过（本任务为纯类名改动，不新增单测）

- [ ] **Step 4: 视觉回归（人工比对）**

Run: `cd web && node scripts/check-surfaces.mjs`
Expected: 脚本完成并输出截图至 `web/audit/surfaces`；人工确认卡片内距变紧、表头变矮，且无内容裁切或溢出

- [ ] **Step 5: 提交**

```bash
cd /d/ZJYPHFA-dev
git add web/src/components/ui/card.tsx web/src/components/data-table/data-table.tsx
git commit -m "feat(ui): 卡片内距收敛至 20px、表格默认档表头收敛至 40px"
```

---

### Task 4: surfaces.css 硬编码圆角对齐

**Files:**
- Modify: `web/src/styles/surfaces.css`（6 处）

**Interfaces:**
- Consumes: Task 1 已将 `--radius` 定为 8px、`--radius-card` 定为 16px
- Produces: `surfaces.css` 中不跟随令牌的硬编码圆角与新的令牌层级保持相对关系

- [ ] **Step 1: 逐处修改圆角**

在 `web/src/styles/surfaces.css` 中改以下 6 处（行号为改动前）：

| 行 | 选择器 | 原值 | 新值 |
| --- | --- | --- | --- |
| 137 | `.module-tab` | `border-radius: 14px` | `border-radius: 10px` |
| 141 | `.module-tabs-scroll` | `border-radius: 12px` | `border-radius: 8px` |
| 144 | `.app-tabs-list` | `border-radius: 14px` | `border-radius: 10px` |
| 146 | `.app-tab-trigger` | `border-radius: 10px` | `border-radius: 8px` |
| 172 | `.detail-table-scroll` | `border-radius: 16px` | `border-radius: 12px` |
| 314 | `.transaction-card-details` | `border-radius: 16px` | `border-radius: 12px` |

不改动：`.kpi-mode-tag`(6px)、`.kpi-comparison-help`(4px)、`.magnitude-value`(8px)、`.aging-matrix-value`(8px)、`.rate-bar-track`(999px)、`[data-ui-table] thead button`(4px)。

- [ ] **Step 2: 确认无遗漏的硬编码圆角**

在 `web/src/styles/` 目录下搜索 `border-radius: 14px` 与 `border-radius: 16px`。
Expected: 0 命中。若有命中，说明存在未对齐的选择器，回到 Step 1 按其所属层级处置（导航/分段控件类降一档，容器类降一档）。

同时确认改后 6 处的取值集合为 `8px` / `10px` / `12px`。

- [ ] **Step 3: 视觉回归（人工比对）**

Run: `cd web && node scripts/check-comparison-surfaces.mjs`
Expected: 脚本完成；人工确认模块分类标签、卡片内分段控件、明细表格容器圆角与卡片协调

- [ ] **Step 4: 提交**

```bash
cd /d/ZJYPHFA-dev
git add web/src/styles/surfaces.css
git commit -m "style(surfaces): 硬编码圆角对齐收敛后的令牌层级"
```

---

### Task 5: 死样式修复 + CSS 变量全量校验

**Files:**
- Modify: `web/src/pages/admin/audit-logs.tsx:62,63,65`
- Test: `web/src/lib/__tests__/css-vars.test.ts`（创建）

**Interfaces:**
- Consumes: `buildThemeCss()`；源码树 `web/src`（测试遍历）
- Produces: `cssVars 引用完整性`测试用例；审计日志页时间线状态色恢复生效

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/__tests__/css-vars.test.ts`：

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildThemeCss } from '../theme-css'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
/** 由第三方库注入、不在本仓库内声明的变量前缀。 */
const RUNTIME_PREFIXES = ['--radix-', '--tw-', '--ant-', '--adm-']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full)
  }
  return out
}

/** 变量定义来源：CSS/TS 中的 `--x:` 声明，以及运行时 setProperty('--x', ...)。 */
function collectDefined(text: string): Set<string> {
  const names = new Set<string>()
  for (const m of buildThemeCss().matchAll(/--([a-z0-9-]+)\s*:/g)) names.add(m[1])
  for (const m of text.matchAll(/--([a-z0-9-]+)\s*:/g)) names.add(m[1])
  for (const m of text.matchAll(/setProperty\(\s*['"]--([a-z0-9-]+)/g)) names.add(m[1])
  return names
}

describe('CSS 变量引用完整性', () => {
  it('源码中引用的 var(--x) 均有定义处或属于运行时前缀', () => {
    const files = walk(SRC)
    const defined = collectDefined(files.map((f) => readFileSync(f, 'utf8')).join('\n'))
    const missing = new Set<string>()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/var\(\s*--([a-z0-9-]+)/g)) {
        const name = `--${m[1]}`
        if (defined.has(m[1])) continue
        if (RUNTIME_PREFIXES.some((p) => name.startsWith(p))) continue
        missing.add(`${file.replace(SRC, 'src/')}: ${name}`)
      }
    }
    expect([...missing].sort()).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/css-vars.test.ts`
Expected: FAIL —— 差集包含 `src/pages/admin/audit-logs.tsx: --state-success`、`--color-primary`、`--state-warning`

- [ ] **Step 3: 修死样式**

在 `web/src/pages/admin/audit-logs.tsx` 第 62、63、65 行，把变量名改为实际存在的令牌：

```tsx
  login: 'border-[color:var(--success)] [&::after]:bg-[color:var(--success)]',
  data: 'border-[color:var(--primary)] [&::after]:bg-[color:var(--primary)]',
  sys: 'border-[color:var(--warning)] [&::after]:bg-[color:var(--warning)]',
```

第 64 行 `perm`（`border-orange-500`）与第 66 行 `other`（`--muted-foreground`）正确，不改。若第 2 步差集中还出现其它文件，逐项核实后同样修正；确属运行时注入的，加入 `RUNTIME_PREFIXES`。

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/css-vars.test.ts`
Expected: PASS，差集为空数组

- [ ] **Step 5: 提交**

```bash
cd /d/ZJYPHFA-dev
git add web/src/pages/admin/audit-logs.tsx web/src/lib/__tests__/css-vars.test.ts
git commit -m "fix(admin): 修复审计日志状态色引用未定义 CSS 变量而静默失效"
```

---

### Task 6: 契约同步

**Files:**
- Modify: `DESIGN.md`（第 21-23、32-33、67、101、164、177-178、208、228 行）

**Interfaces:**
- Consumes: Task 1–5 确定的新参数值
- Produces: `DESIGN.md` 中的圆角/内距条款与实现一致

- [ ] **Step 1: 更新圆角条款**

在 `DESIGN.md` 中逐处改：

| 行 | 原文 | 改为 |
| --- | --- | --- |
| 21-23 | frontmatter `rounded: DEFAULT: "12px" / card: "24px" / control: "12px"` | `DEFAULT: "8px" / card: "16px" / control: "8px"` |
| 32-33 | `components.card` 的 `rounded: "24px" / padding: "24px"` | `rounded: "16px" / padding: "20px"` |
| 67 | 「卡片圆角统一 24px，控件 12px，导航选中区域 14px」 | 「卡片圆角统一 16px，控件 8px，导航选中区域 10px」 |
| 101 | 「共享控件圆角 12px，配方卡片 24px」 | 「共享控件圆角 8px，配方卡片 16px」 |
| 164 | 「桌面默认 24px、手机 16px 内边距」 | 「桌面默认 20px、手机 16px 内边距」 |
| 177 | 「主色 14px 圆角胶囊」 | 「主色 10px 圆角胶囊」 |
| 178 | 「复用 14px 外框、10px 内部选中面」 | 「复用 10px 外框、8px 内部选中面」 |
| 208 | 「顶栏控件高 36px、圆角 12px」 | 「顶栏控件高 36px、圆角 8px」 |
| 228 | 「StatTile 的 24px 圆角、24/16px 内边距」 | 「StatTile 的 16px 圆角、20/16px 内边距」 |

同时把第 67 行关于阴影的描述（若有具体数值）与 Task 2 的新值对齐。

- [ ] **Step 2: 确认无残留旧值**

在 `DESIGN.md` 中搜索 `24px` 与 `14px`。
Expected: 仅剩与圆角无关的条款——第 88 行「桌面水平边距 24px」、第 138 行「控件高 44px」。若仍有圆角相关的 `24px` / `14px`，逐条修正。

- [ ] **Step 3: 提交**

```bash
cd /d/ZJYPHFA-dev
git add DESIGN.md
git commit -m "docs(design): 同步圆角与内距条款至收敛后的参数"
```

---

## 验证与收尾

- [ ] **全量门禁**

```bash
cd /d/ZJYPHFA-dev && npm run verify
```
Expected: 全部通过。若出现 Prisma 假错，按 `docs/plans/环境管理规范.md` 确认开发库与 `prisma generate` 前置。

- [ ] **四主题 × 桌面/手机 视觉回归**

```bash
cd /d/ZJYPHFA-dev/web
node scripts/check-redesign.mjs
node scripts/check-responsive-layout.mjs
node scripts/check-surfaces.mjs
```
Expected: 四套主题下卡片、表格、导航、明细容器的圆角与内距协调；手机端卡片左右仍为 16px。

- [ ] **待决项回归 Spec**

Task 6 完成后，更新 Spec `docs/superpowers/specs/2026-10-19-frontend-polish-and-capabilities-design.md`：将 §9「推断与待决」中的第 3、4 项标注为已决（本次已按"陈列页不动、admin 设计债只修死样式"处理），并把 §3.2 的 Major 死样式一项标记为已修复。
