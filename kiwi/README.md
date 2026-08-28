# kiwi 知识库 · 记录规范与使用流程

## 1. 项目简介

**kiwi 知识库**是一个**纯本地运行的改动知识库**，用于结构化记录项目的重要改动，让历史改动可追溯、可检索、可审计。

技术架构：**Markdown 记录 + YAML frontmatter 元数据 + CLI 工具（`kiwi.mjs`）+ Git 版本控制**，零部署成本、零第三方运行时依赖。

**适用场景**：
- 需要按「项目 / 类型 / 负责人 / 时间 / 标签」等多维度回溯历史改动的团队
- 希望用最轻量方式（纯文件 + Git）沉淀改动上下文（为什么改、改了哪些文件、影响什么）
- 需要对重要 bug 修复、接口变更、架构决策做留痕审计的团队

## 2. 目录结构

```
kiwi/
├── records/                          # 改动记录库（核心数据）
│   └── <project>/<type>/YYYY-MM-DD-<slug>.md   # 按项目/类型/日期组织
├── templates/                        # 记录模板（new 命令按此生成）
│   └── record.md
├── config/
│   ├── kiwi.config.json              # type 枚举、必填/可选字段、records 根路径
│   └── roles.json                    # 用户角色定义（admin/editor/viewer）
├── scripts/                          # CLI 工具（Node 原生，无第三方依赖）
│   ├── kiwi.mjs                      # 入口
│   └── lib/                          # 子命令分模块实现
└── README.md                         # 本文档
```

## 3. 记录时机规范

**必须记录**（满足任一即记）：
- 影响**接口契约 / 数据结构 / 关键业务流程**的改动
- 涉及**部署配置、环境变量、构建产物**的改动
- **重要 bug 修复**（根因非显而易见、或影响线上行为的）
- **架构决策**（技术选型、方案取舍、性能优化策略）
- 数据迁移、脚本回填等不可逆或高风险操作

**可不记录**：琐碎样式微调、错别字修正、临时调试代码、注释完善等不影响行为的琐碎改动。

> 记录粒度由团队按需裁剪，宁可精简不可泛滥；拿不准时记录。

## 4. 命名与格式规范

### 4.1 文件名规则

```
YYYY-MM-DD-<slug>.md
例：2026-08-28-fix-login-timeout.md
```

- 日期为记录创建日；`slug` 为小写英文短横线连接的语义化短语（≤5 个单词）

### 4.2 frontmatter 字段说明

**必填字段**：

| 字段 | 含义 | 格式 | 示例 |
|---|---|---|---|
| `id` | 记录唯一标识 | `REC-YYYYMMDD-NNN`，`new` 自动生成 | `REC-20260828-001` |
| `project` | 所属项目 | 项目标识名，即 records 下的一级目录名 | `fy200-clone` |
| `type` | 改动类型 | 枚举值（见 4.3） | `fix` |
| `date` | 记录日期 | `YYYY-MM-DD` | `2026-08-28` |
| `title` | 一句话标题 | 简明描述本次改动 | `修复登录超时` |
| `owner` | 负责人 | 姓名，与 roles.json 一致 | `张三` |
| `files` | 相关文件路径列表 | 数组，相对仓库根路径 | `- web/src/pages/Login.tsx` |
| `reason` | 改动原因 | 单值，说明为什么改 | `会话 token 过期未续期导致 30s 后掉线` |

**可选字段**：

| 字段 | 含义 | 格式 | 示例 |
|---|---|---|---|
| `tags` | 标签 | 字符串数组，便于 list --tag 筛选 | `[登录, 认证]` |
| `related` | 关联记录 id | 数组 | `[REC-20260827-002]` |
| `status` | 状态 | 如 `done` / `follow-up`，默认 done | `done` |

### 4.3 type 枚举

初始枚举：`feat | fix | refactor | docs | config | perf | test | other`

枚举由 `config/kiwi.config.json` 驱动，**可扩展**（见第 10 节）；`new` 与 `validate` 遇到未定义的 type 会拒绝并提示合法值。

### 4.4 正文标准章节

```markdown
## 改动内容
<!-- 详细描述做了什么：方案、关键代码位置、数据变化等 -->

## 影响范围
<!-- 受影响的模块/接口/页面/部署环节、风险点、回归验证方式 -->

## 修订记录
<!-- 已定稿后的修正在此追加，格式：- 2026-09-01 张三 修正 XXX 结论 -->
```

## 5. 标准使用流程

```bash
# ① 改动代码完成、自测通过后，创建记录（frontmatter 自动生成，id 自动分配）
node kiwi/scripts/kiwi.mjs new --project=fy200-clone --type=fix --title="修复登录超时" --owner=张三
#    → 输出：kiwi/records/fy200-clone/fix/2026-08-28-修复登录超时.md

# ② 编辑该文件，填写 frontmatter 的 files/reason 及正文三个章节

# ③ 校验全库规范（必填字段/type/date/id 唯一/文件名）
node kiwi/scripts/kiwi.mjs validate

# ④ 校验通过后 Git 提交（记录文件必须纳入 Git 追踪，log 命令依赖提交历史）
git add kiwi/records/ && git commit -m "kiwi: 记录 修复登录超时 (REC-20260828-001)"
```

## 6. 常用查询命令一览

所有命令均在仓库根目录执行，统一入口 `node kiwi/scripts/kiwi.mjs`。

| 子命令 | 用法示例 | 说明 |
|---|---|---|
| `list` | `node kiwi/scripts/kiwi.mjs list --project=fy200-clone --type=fix --from=2026-08-01 --to=2026-08-31` | 组合筛选：`--project` / `--type` / `--owner` / `--from` / `--to` / `--tag` / `--status`，输出 id、日期、标题、负责人 |
| `search` | `node kiwi/scripts/kiwi.mjs search 主题切换` | 全文搜索（大小写不敏感，含 frontmatter 与正文），输出文件路径 + 命中行 |
| `show` | `node kiwi/scripts/kiwi.mjs show REC-20260828-001` | 按 id 精确查看单条记录全文 |
| `log` | `node kiwi/scripts/kiwi.mjs log REC-20260828-001` | 查看该记录文件的 Git 提交历史（hash、日期、作者、提交信息）；尚无提交时给出提示 |
| `whoami` | `node kiwi/scripts/kiwi.mjs whoami` | 显示当前身份识别结果与对应角色 |
| `validate` | `node kiwi/scripts/kiwi.mjs validate` | 扫描全库校验规范，输出错误清单与汇总；全部通过退出码为 0 |

## 7. 权限说明

角色由 `config/roles.json` 定义：

| 角色 | 权限 |
|---|---|
| `admin` | 全部权限（含维护 roles.json） |
| `editor` | 创建、编辑记录 |
| `viewer` | 只读（可查询，不可创建） |

**身份识别**：优先读取环境变量 `KIWI_USER`；未设置时取 `git config user.name`，需与 roles.json 中登记的 `name` 完全一致。

**写操作门禁**：`new` 执行前校验身份——未登记或角色为 `viewer` 时拒绝执行，并提示「身份未登记 / 权限不足」及 roles.json 维护人联系方式。可用 `whoami` 自查身份。

**roles.json 维护**：由 admin 维护，人员增减与角色调整后须 Git 提交留痕。

## 8. 管控边界（重要）

本地权限校验属于「**约定层**」：CLI 门禁只约束使用 kiwi 命令的写路径，**无服务端强制力**——用户可直接改文件绕过校验。若需强管控，须配合 Git 平台能力：

- 对 `kiwi/` 目录启用**分支保护**（禁止直推 main）
- 强制 **Code Review**（记录文件改动需至少一名 admin 审核）
- 可将 `validate` 接入 CI 或 pre-push 钩子做入库前兜底校验

## 9. 修订原则

- **已定稿记录的修正**：在「修订记录」章节**追加**说明（日期 + 修订人 + 内容），**不得静默改写**历史结论
- **文件级演变**：由 Git 承担，用 `git diff` / `kiwi.mjs log <id>` 查看任意版本的变更轨迹
- 原则：知识库记录的是「当时的判断 + 后来的修正」全过程，而非只留最终结论

## 10. 扩展性

- **新增 type 枚举值**：仅改 `config/kiwi.config.json` 的 type 列表，无需改代码
- **新增字段**：改 config 的 `requiredFields` / `optionalFields`，并同步 `templates/record.md` 模板
- **未来模块**：CLI 按子命令分模块实现（`scripts/lib/`），可平滑接入 `export`（导出静态站）、`sync`（远程同步）、Web UI 等扩展，不改动既有命令
