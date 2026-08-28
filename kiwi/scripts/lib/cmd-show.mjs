/**
 * 子命令 show：按记录 id 精确定位并输出记录全文。
 */
import { findRecordById } from './config.mjs';

export const usage = [
  '用法：node kiwi/scripts/kiwi.mjs show <id>',
  '',
  '说明：按记录 id（frontmatter 的 id 字段）精确定位单条记录，输出其全文（含 frontmatter）。',
].join('\n');

export async function run(args) {
  const id = args[0];
  if (!id || !String(id).trim()) {
    console.error('缺少参数：<id>');
    console.error(usage);
    process.exit(1);
  }

  const rec = findRecordById(String(id).trim());
  if (!rec) {
    console.error(`未找到记录：${id}`);
    process.exit(1);
  }

  console.log(rec.content.trimEnd());
}
