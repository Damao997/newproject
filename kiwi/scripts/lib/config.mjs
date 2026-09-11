/**
 * kiwi 配置与记录库工具。
 * 路径均相对 kiwi 根解析（通过 import.meta.url 定位，与运行 cwd 无关）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** kiwi 根目录（本文件位于 kiwi/scripts/lib/ 下） */
export const KIWI_ROOT = path.resolve(here, '..', '..');

/** 以相对工作区 cwd 的路径展示（便于阅读）；不在 cwd 下时返回绝对路径 */
export function displayPath(absPath) {
  const rel = path.relative(process.cwd(), absPath);
  if (!rel || rel.startsWith('..')) return absPath;
  return rel;
}

function readJson(absPath, label) {
  if (!fs.existsSync(absPath)) {
    console.error(`配置缺失：未找到 ${label}（${displayPath(absPath)}）`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (err) {
    console.error(`配置解析失败：${label}：${err.message}`);
    process.exit(1);
  }
}

/** 读取 kiwi/config/kiwi.config.json */
export function loadConfig() {
  return readJson(path.join(KIWI_ROOT, 'config', 'kiwi.config.json'), 'config/kiwi.config.json');
}

/** 读取 kiwi/config/roles.json */
export function loadRoles() {
  return readJson(path.join(KIWI_ROOT, 'config', 'roles.json'), 'config/roles.json');
}

/** 记录库根目录（recordsRoot 相对 kiwi 根） */
export function getRecordsRoot() {
  const cfg = loadConfig();
  const rel = typeof cfg.recordsRoot === 'string' && cfg.recordsRoot.trim() ? cfg.recordsRoot.trim() : 'records';
  return path.resolve(KIWI_ROOT, rel);
}

/** 今天（本地时区）的 YYYY-MM-DD */
export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 生成记录 id：REC-YYYYMMDD-NNN。
 * 扫描当日已存在记录取最大序号 +1，从 001 起。
 */
export function generateId(dateStr) {
  const compact = String(dateStr).replace(/-/g, '');
  const prefix = `REC-${compact}-`;
  let max = 0;
  for (const rec of listAllRecords()) {
    const { data } = parseFrontmatter(rec.content);
    const id = data && data.id;
    if (typeof id === 'string' && id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** 由标题生成 slug：ASCII 词转 kebab-case；无 ASCII 词时回退 "record" */
export function generateSlug(title) {
  const words = String(title ?? '').match(/[A-Za-z0-9]+/g);
  if (!words || words.length === 0) return 'record';
  const slug = words.join('-').toLowerCase();
  return slug.length > 60 ? slug.slice(0, 60).replace(/-+$/, '') : slug;
}

/**
 * 路径段安全校验：禁止 ".."、路径分隔符、控制字符、首尾点号与 Windows 保留设备名。
 * 不合法时打印中文错误并 exit 1。
 */
export function assertSafeSegment(value, argName) {
  const v = String(value ?? '');
  const problems = [];
  if (!v.trim()) problems.push('不能为空');
  if (v.includes('..')) problems.push('禁止包含 ".."');
  if (/[/\\]/.test(v)) problems.push('禁止包含路径分隔符 / 或 \\');
  if (/[\u0000-\u001f]/.test(v)) problems.push('包含非法控制字符');
  if (v.startsWith('.') || v.endsWith('.')) problems.push('不能以 "." 开头或结尾');
  if (/\s$/.test(v)) problems.push('不能以空白结尾');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(v)) problems.push('为 Windows 保留设备名');
  if (problems.length > 0) {
    console.error(`参数 --${argName} 不合法（值：${v}）：${problems.join('；')}`);
    process.exit(1);
  }
  return v;
}

/** 遍历记录库全部 .md 记录（深度优先、按名称排序；relPath 为相对记录根的 posix 路径） */
export function listAllRecords() {
  const root = getRecordsRoot();
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(abs, relChild);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        out.push({ absPath: abs, relPath: relChild, content: fs.readFileSync(abs, 'utf8') });
      }
    }
  };
  walk(root, '');
  return out;
}

/** 按 id 查找记录；找到返回 { absPath, relPath, data, content }，否则返回 null */
export function findRecordById(id) {
  for (const rec of listAllRecords()) {
    const { data } = parseFrontmatter(rec.content);
    if (data && data.id === id) return { ...rec, data };
  }
  return null;
}
