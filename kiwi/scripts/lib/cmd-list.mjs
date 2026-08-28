/**
 * 子命令 list：按项目/类型/负责人/日期区间/标签/状态组合筛选记录，表格化输出。
 */
import { listAllRecords } from './config.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

export const usage = [
  '用法：node kiwi/scripts/kiwi.mjs list [--project=<项目>] [--type=<类型>] [--owner=<负责人>]',
  '      [--from=<YYYY-MM-DD>] [--to=<YYYY-MM-DD>] [--tag=<标签>] [--status=<状态>]',
  '',
  '说明：',
  '  所有筛选项均可省略，省略即不过滤；不传任何筛选项时列出全部记录；',
  '  --from / --to 为闭区间（含边界），按记录 date 字段比较；',
  '  --tag 匹配 tags 数组中包含该标签的记录。',
].join('\n');

function parseArgs(args) {
  const opts = {};
  for (const arg of args) {
    const m = typeof arg === 'string' ? arg.match(/^--([^=]+)=(.*)$/) : null;
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

/** 近似显示宽度：CJK / 全角字符按 2 列计，其余按 1 列 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    const wide = (code >= 0x2e80 && code <= 0x9fff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xff01 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

function padEndDisplay(s, width) {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** tags 是否包含指定标签（兼容数组与单值字符串两种形态） */
function matchTag(data, tag) {
  const tags = data.tags;
  if (Array.isArray(tags)) return tags.includes(tag);
  return typeof tags === 'string' && tags === tag;
}

export async function run(args) {
  const opts = parseArgs(args);
  const { project, type, owner, tag, status } = opts;
  const from = opts.from;
  const to = opts.to;

  const rows = [];
  for (const rec of listAllRecords()) {
    const { data } = parseFrontmatter(rec.content);
    if (project && data.project !== project) continue;
    if (type && data.type !== type) continue;
    if (owner && data.owner !== owner) continue;
    if (status && data.status !== status) continue;
    if (tag && !matchTag(data, tag)) continue;
    const date = String(data.date ?? '');
    if (from && date < from) continue;
    if (to && date > to) continue;
    rows.push([String(data.id ?? ''), date, String(data.project ?? ''), String(data.type ?? ''), String(data.title ?? ''), String(data.owner ?? '')]);
  }

  if (rows.length === 0) {
    console.log('没有匹配的记录。');
    return;
  }

  const header = ['ID', '日期', '项目', '类型', '标题', '负责人'];
  const table = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...table.map((row) => displayWidth(row[i]))));
  const line = (row) => row.map((cell, i) => padEndDisplay(cell, widths[i])).join('  ').trimEnd();

  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log(`\n共 ${rows.length} 条记录。`);
}
