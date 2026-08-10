/**
 * AI 输出模板配置（analyze 追加分析 / overview 全局预分析）。
 *
 * 模板 = 输出分节结构（每节：标题 + 内容要求），由 AIProxyService 的 buildTemplatePrompt
 * 组装进 system prompt，控制 LLM 输出的分节组织与每节内容。
 *
 * 自定义方式（无需改管道代码）：
 *   1. 修改下方 AI_TEMPLATES 中对应模板的 sections（增删节 / 改标题 / 改要求）；
 *   2. 重启后端服务后生效。
 * 注意：polish / summarize / formula 管道暂不支持模板，不受本文件影响。
 */

/** 单个输出节：LLM 以 title 为节首行输出，并按 requirement 组织该节内容 */
export interface AiSectionTemplate {
  /** 节标题（LLM 输出的节首行；留空表示无标题的引言段） */
  title: string
  /** 该节内容要求（自然语言指令） */
  requirement: string
}

/** 一个 AI 输出模板：分节结构 + 元信息 */
export interface AiOutputTemplate {
  /** 模板标识（overview / analyze），与 AIProxyService 管道对应 */
  key: string
  /** 模板名称（日志/审计用） */
  name: string
  sections: AiSectionTemplate[]
}

export const AI_TEMPLATES: Record<string, AiOutputTemplate> = {
  overview: {
    key: 'overview',
    name: '全局预分析',
    sections: [
      { title: '整体指标趋势概览', requirement: '总结主体整体经营态势与主要趋势方向' },
      { title: '关键指标变化识别', requirement: '识别同比/累计同比大幅增长或下降的指标，结合数据说明可能含义' },
      { title: '预算达成情况总结', requirement: '归纳达成率偏低或超额的指标及其影响' },
      { title: '月度与累计对比分析', requirement: '比较本月实际同比与本年累计同比的差异，提示月度波动与累计走势的关系；以分条列述，禁止使用 markdown 表格' },
    ],
  },
  analyze: {
    key: 'analyze',
    name: '追加分析',
    sections: [
      { title: '本期表现概览', requirement: '概述该指标本月实际、同比与达成率的当期表现' },
      { title: '同比与预算分析', requirement: '结合同期数据与预算达成情况分析增减原因；以分条列述，禁止使用 markdown 表格' },
      { title: '趋势研判与建议', requirement: '结合累计同比判断趋势并给出经营建议' },
    ],
  },
}
