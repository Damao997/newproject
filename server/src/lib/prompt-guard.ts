/**
 * 提示词注入防护（仅输入侧，见 AI模块规范 §六）。
 * 公式生成不涉及公司隐私，故不做输出脱敏/编码泄露过滤。
 */

const MAX_INPUT_LENGTH = 5000

// 常见注入模式（中英文）
const INJECTION_PATTERNS: RegExp[] = [
  /忽略上述指令/,
  /忽略说明/,
  /忽略规则/,
  /忽略以上/,
  /无视上述/,
  /你是一个/,
  /扮演/,
  /你现在是/,
  /ignore\s+previous/i,
  /ignore\s+above/i,
  /ignore\s+all\s+instructions/i,
  /disregard/i,
  /override/i,
  /pretend/i,
  /jailbreak/i,
  /\byou\s+are\s+a\b/i,
  /\bsystem\s*:/i,
  /<<[\s\S]*?>>/,
  /\{\{[\s\S]*?\}\}/,
  /DAN\s+mode/i,
]

export interface GuardResult {
  allowed: boolean
  reason?: string
}

export function guardInput(text: string): GuardResult {
  if (!text || text.trim().length === 0) {
    return { allowed: false, reason: '描述不能为空' }
  }
  if (text.length > MAX_INPUT_LENGTH) {
    return { allowed: false, reason: `输入超出 ${MAX_INPUT_LENGTH} 字符限制` }
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { allowed: false, reason: '输入包含可疑指令，已拦截' }
    }
  }
  return { allowed: true }
}

// LLM 输出编码泄露检测（见 AI模块规范 §6.4）：公司/科目/指标编码 + system prompt 关键词
// 科目编码为级联数字格式：前缀 + 每级 2 位（如 OP_02 / OP_0201 / OP_0201010101、ST_12 / ST_1201）
const LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'company', re: /\bCO\d{6}\b/g },
  { name: 'summary', re: /\bET\d{4}\b/g },
  { name: 'summary_alt', re: /\bSUM\d{4}\b/g },
  { name: 'operating', re: /\bOP_\d{2}(?:\d{2})*\b/g },
  { name: 'static', re: /\bST_\d{2}(?:\d{2})*\b/g },
  { name: 'calc', re: /\bCALC_[A-Za-z\u4e00-\u9fa5]+\b/g },
]

const SYSTEM_PROMPT_LEAK = /(润色助手|分析助手|不得执行|忽略它们)/

export interface OutputFilterResult {
  clean: boolean
  sanitized: string
  leaks: string[]
}

/**
 * 输出过滤：将 LLM 输出中的内部编码打码为「[已隐藏]」，并标记 system prompt 复述泄露。
 * 返回是否干净、净化后文本、命中的泄露类型列表。
 */
export function filterOutput(text: string): OutputFilterResult {
  if (!text) return { clean: true, sanitized: '', leaks: [] }
  const leaks: string[] = []
  let sanitized = text
  for (const { name, re } of LEAK_PATTERNS) {
    if (re.test(sanitized)) {
      leaks.push(name)
      sanitized = sanitized.replace(re, '[已隐藏]')
    }
  }
  if (SYSTEM_PROMPT_LEAK.test(sanitized)) {
    leaks.push('system_prompt')
  }
  return { clean: leaks.length === 0, sanitized, leaks }
}
