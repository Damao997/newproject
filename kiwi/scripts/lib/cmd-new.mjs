/**
 * 子命令 new：按模板创建一条改动记录（写操作，需通过权限门禁）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  KIWI_ROOT,
  getRecordsRoot,
  loadConfig,
  generateId,
  generateSlug,
  todayStr,
  assertSafeSegment,
  displayPath,
} from './config.mjs';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { requireWriter } from './perm.mjs';

export const usage = [
  '用法：node kiwi/scripts/kiwi.mjs new --project=<项目> --type=<类型> --title="<标题>" --owner=<负责人>',
  '      [--slug=<slug>] [--reason="<原因>"] [--files=<路径1,路径2>] [--tags=<标签1,标签2>] [--related=<id1,id2>] [--status=<状态>]',
  '',
  '说明：',
  '  --project / --type / --title / --owner 为必填参数；',
  '  --type 必须是 config/kiwi.config.json 中 types 枚举内的值；',
  '  --slug 缺省时由标题中的 ASCII 词生成（无 ASCII 词时为 record）；',
  '  --status 缺省为 draft；记录文件生成于 records/<project>/<type>/<YYYY-MM-DD>-<slug>.md。',
].join('\n');

function parseArgs(args) {
  const opts = {};
  for (const arg of args) {
    const m = typeof arg === 'string' ? arg.match(/^--([^=]+)=(.*)$/) : null;
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

function splitList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 读取模板并渲染：frontmatter 字段由模板驱动，正文替换占位符 */
function renderRecord(fields) {
  const templatePath = path.join(KIWI_ROOT, 'templates', 'record.md');
  if (!fs.existsSync(templatePath)) {
    console.error(`模板缺失：${displayPath(templatePath)}`);
    process.exit(1);
  }
  const tpl = parseFrontmatter(fs.readFileSync(templatePath, 'utf8'));

  const scalars = {
    id: fields.id,
    project: fields.project,
    type: fields.type,
    date: fields.date,
    title: fields.title,
    owner: fields.owner,
    reason: fields.reason,
    status: fields.status,
  };
  const arrays = { files: fields.files, tags: fields.tags, related: fields.related };

  const data = {};
  for (const [key, value] of Object.entries(tpl.data)) {
    if (Array.isArray(value)) {
      const vals = arrays[key];
      if (Array.isArray(vals) && vals.length > 0) data[key] = vals; // 未提供则省略该字段
    } else if (typeof value === 'string') {
      const m = value.match(/^\{\{(\w+)\}\}$/);
      data[key] = m && scalars[m[1]] !== undefined ? scalars[m[1]] : value;
    } else {
      data[key] = value;
    }
  }

  const body = tpl.body.replace(/\{\{(\w+)\}\}/g, (raw, key) =>
    Object.prototype.hasOwnProperty.call(scalars, key) && scalars[key] ? scalars[key] : raw);

  return `${serializeFrontmatter(data)}${body}`;
}

export async function run(args) {
  // —— 权限门禁（写路径最前面）——
  const { user, role } = requireWriter();

  const opts = parseArgs(args);

  const missing = ['project', 'type', 'title', 'owner'].filter((k) => !opts[k] || !String(opts[k]).trim());
  if (missing.length > 0) {
    console.error(`缺少必填参数：${missing.map((k) => `--${k}`).join('、')}`);
    console.error(usage);
    process.exit(1);
  }

  const cfg = loadConfig();
  const types = Array.isArray(cfg.types) ? cfg.types : [];

  const project = assertSafeSegment(String(opts.project).trim(), 'project');
  const title = String(opts.title).trim();
  const owner = String(opts.owner).trim();
  const type = String(opts.type);

  if (!types.includes(type)) {
    console.error(`type 不合法：${type}（合法值：${types.join(', ')}）`);
    process.exit(1);
  }

  const slug = opts.slug ? assertSafeSegment(String(opts.slug).trim(), 'slug') : generateSlug(title);
  const date = todayStr();
  const id = generateId(date);

  const dir = path.join(getRecordsRoot(), project, type);
  const fileName = `${date}-${slug}.md`;
  const filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath)) {
    console.error(`记录文件已存在：${displayPath(filePath)}`);
    console.error('请更换 --slug 后重试，或先处理同名旧记录。');
    process.exit(1);
  }

  const files = splitList(opts.files);
  const tags = splitList(opts.tags);
  const related = splitList(opts.related);
  const reason = opts.reason ? String(opts.reason).trim() : '';
  const status = opts.status && String(opts.status).trim() ? String(opts.status).trim() : 'draft';

  const content = renderRecord({ id, project, type, date, title, owner, reason, status, files, tags, related });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  console.log(`✓ 记录已创建：${displayPath(filePath)}`);
  console.log(`  id：${id}`);
  console.log(`  身份：${user}（${role}）`);
  const warnings = [];
  if (!reason) warnings.push('reason 为必填字段，当前为空，请在 Git 提交前补充');
  if (files.length === 0) warnings.push('files 为必填字段，当前为空，请在 Git 提交前补充');
  for (const w of warnings) console.warn(`⚠ 提示：${w}（可运行 validate 检查完整性）`);
}
