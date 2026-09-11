/**
 * 子命令 validate：全库扫描 records/，逐条校验记录规范，输出错误清单与汇总。
 */
import { loadConfig, listAllRecords, displayPath } from './config.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const FILE_NAME_RE = /^\d{4}-\d{2}-\d{2}-.+\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isEmptyField(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

export async function run() {
  const cfg = loadConfig();
  const types = Array.isArray(cfg.types) ? cfg.types : [];
  const requiredFields = Array.isArray(cfg.requiredFields) ? cfg.requiredFields : [];
  const records = listAllRecords();

  if (records.length === 0) {
    console.log('记录库为空（records/ 下暂无 .md 记录）。');
    console.log('校验完成：通过 0 条 / 失败 0 条');
    return;
  }

  const idOwners = new Map(); // id → 首次出现的记录相对路径
  const problems = []; // { display, errors }
  let passCount = 0;

  for (const rec of records) {
    const errors = [];
    const display = displayPath(rec.absPath);
    const fileName = rec.relPath.split('/').pop();
    const parts = rec.relPath.split('/');
    const { hasFrontmatter, data } = parseFrontmatter(rec.content);

    if (!hasFrontmatter) {
      errors.push('缺少 frontmatter（文件需以 --- 开始，元数据结束后以 --- 收尾）');
    } else {
      const missing = requiredFields.filter((f) => isEmptyField(data[f]));
      if (missing.length > 0) errors.push(`缺少必填字段或字段为空：${missing.join('、')}`);

      if (!isEmptyField(data.type) && !types.includes(data.type)) {
        errors.push(`type 不合法：${data.type}（合法值：${types.join(', ')}）`);
      }

      if (!isEmptyField(data.date) && !isValidDate(data.date)) {
        errors.push(`date 格式错误：${data.date}（应为 YYYY-MM-DD 的真实日期）`);
      }

      if (!FILE_NAME_RE.test(fileName)) {
        errors.push(`文件名不符合 <YYYY-MM-DD>-<slug>.md 规范：${fileName}`);
      }

      if (parts.length !== 3) {
        errors.push(`目录结构应为 <project>/<type>/<文件名>，实际为 ${rec.relPath}`);
      } else {
        const dirMatches = parts[0] === data.project && parts[1] === data.type;
        if (!dirMatches) {
          errors.push(`目录结构与 frontmatter 不一致：实际 ${rec.relPath}，按元数据应为 ${[data.project, data.type, fileName].join('/')}`);
        }
      }

      if (!isEmptyField(data.id)) {
        if (!idOwners.has(data.id)) {
          idOwners.set(data.id, rec.relPath);
        } else {
          errors.push(`id 重复：${data.id} 已存在于 ${idOwners.get(data.id)}`);
        }
      }
    }

    if (errors.length > 0) problems.push({ display, errors });
    else passCount += 1;
  }

  if (problems.length > 0) {
    console.log(`发现 ${problems.length} 条记录存在问题：`);
    for (const p of problems) {
      console.log(`✗ ${p.display}`);
      for (const e of p.errors) console.log(`    - ${e}`);
    }
  }

  const failCount = records.length - passCount;
  if (failCount === 0) console.log('✓ 全部记录符合规范');
  console.log(`校验完成：通过 ${passCount} 条 / 失败 ${failCount} 条`);
  if (failCount > 0) process.exitCode = 1;
}
