/**
 * 轻量 YAML frontmatter 解析 / 序列化（零第三方依赖）。
 *
 * 支持范围（刻意保持最小）：
 * - 字符串值（含引号包裹、值中带冒号/井号）
 * - ISO 日期字符串（YYYY-MM-DD，按原样字符串处理）
 * - 字符串数组（`key:` + `  - item` 形式）
 * - 不支持多行值、嵌套结构、行内数组等高级特性
 */

/** 去除包裹引号并反转义 */
function unquote(raw) {
  const t = String(raw).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** 值是否需要用双引号包裹后再写入 */
function needsQuote(v) {
  if (v === '') return true;
  if (/^\s|\s$/.test(v)) return true;
  if (/[:#]/.test(v)) return true;
  if (/^[-?:,&*!|>'"%@`{}[\]]/.test(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return true;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return true;
  return false;
}

function formatScalar(value) {
  const s = String(value);
  if (!needsQuote(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 将 frontmatter 文本解析为普通对象（保持键序；无法识别的行忽略） */
function parseYamlish(text) {
  const data = {};
  let lastKey = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ')) {
      if (lastKey === null) continue;
      if (!Array.isArray(data[lastKey])) data[lastKey] = [];
      data[lastKey].push(unquote(trimmed.slice(2)));
      continue;
    }
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = unquote(trimmed.slice(0, idx));
    const rawVal = trimmed.slice(idx + 1).trim();
    lastKey = key;
    data[key] = rawVal === '' ? '' : unquote(rawVal);
  }
  return data;
}

/**
 * 解析含 frontmatter 的 Markdown 文本。
 * 返回 { hasFrontmatter, data, body }；无 frontmatter 时 data 为 {}、body 为原文。
 */
export function parseFrontmatter(content) {
  const text = String(content ?? '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { hasFrontmatter: false, data: {}, body: text };
  return { hasFrontmatter: true, data: parseYamlish(m[1]), body: text.slice(m[0].length) };
}

/** 将对象序列化为 frontmatter 文本（以 `---\n` 结尾，可直接拼接正文） */
export function serializeFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${formatScalar(item)}`);
    } else if (value === undefined || value === null) {
      lines.push(`${key}: ""`);
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}
