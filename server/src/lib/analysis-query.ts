import { z } from 'zod'

/**
 * 即席分析查询请求体 schema（见 docs/plans/即席分析模块技术方案.md §4.2）。
 * 仅做结构校验；跨字段校验（period 是否在可用期间内、metrics 是否属于该维度）
 * 在 AnalysisQueryService 中完成——那里才知道该维度的指标组集合。
 * 校验收敛到后端：Zod 前后端共享，见 CLAUDE.md。
 */

/** 行维度枚举（§6 行维度适配器注册表） */
export const ROW_DIMS = ['product', 'category', 'expense', 'subject', 'company'] as const
export type RowDim = (typeof ROW_DIMS)[number]

const PERIOD_RE = /^\d{4}-\d{2}$/

const filtersSchema = z.object({
  /** 去重分类模拟口径（复用 AggregationService 的日志回放，只读） */
  excludeReclassify: z.boolean().default(false),
  /** 行名关键字过滤（空 = 不过滤） */
  keyword: z.string().trim().max(100).default(''),
  /** 限定行成员编码（空 = 全部）；上限 500 防超长 IN 查询 */
  rowCodes: z.array(z.string().trim().min(1).max(64)).max(500).default([]),
}).strict()

const optionsSchema = z.object({
  /** 保留零值行（品类全量展示场景，等价现有 keepEmpty） */
  includeEmptyRows: z.boolean().default(false),
  /** 是否返回合计行 */
  includeTotals: z.boolean().default(true),
  /** 仅 rowDim=subject 时生效：按科目层级过滤 */
  level: z.number().int().min(0).max(3).nullable().default(null),
}).strict()

export const analysisQuerySchema = z.object({
  /** 缺省按用户 scope 汇总；汇总主体编码自动展开成员 */
  companyCode: z.string().trim().min(1).max(32).optional(),
  /** 缺省取最新可用期间 */
  period: z.string().regex(PERIOD_RE, '期间格式须为 YYYY-MM').optional(),
  rowDim: z.enum(ROW_DIMS),
  /** 列维度（矩阵模式，v2 新增）：省略时保持 v1 单轴形态（指标为列） */
  colDim: z.enum(ROW_DIMS).optional(),
  /** 限定列成员编码（空 = 全部）；仅 colDim 存在时生效，上限同 COL_MEMBER_LIMIT */
  colCodes: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  filters: filtersSchema.optional(),
  // 上限 60：多指标组维度下「全选」需要 2 组 × 19 = 38（product）、3 组 × 19 = 57（company），
  // 原方案的 30 会让这两类维度无法全选（实现时发现的方案偏差，已回写技术方案文档）
  metrics: z.array(z.string().trim().min(1).max(64)).max(60).optional(),
  options: optionsSchema.optional(),
}).strict().superRefine((v, ctx) => {
  // 行列同维无矩阵意义（对角线退化）；在 schema 层拒绝，service 不需要重复校验
  if (v.colDim && v.colDim === v.rowDim) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['colDim'], message: '列维度不能与行维度相同' })
  }
})

/** 矩阵列成员上限：防 5 维 × 指标组合爆炸（与 colCodes 上限一致） */
export const COL_MEMBER_LIMIT = 50

export type AnalysisQuerySpec = z.infer<typeof analysisQuerySchema>
export type AnalysisQueryFilters = NonNullable<AnalysisQuerySpec['filters']>
export type AnalysisQueryOptions = NonNullable<AnalysisQuerySpec['options']>

export const DEFAULT_FILTERS: AnalysisQueryFilters = { excludeReclassify: false, keyword: '', rowCodes: [] }
export const DEFAULT_OPTIONS: AnalysisQueryOptions = { includeEmptyRows: false, includeTotals: true, level: null }
