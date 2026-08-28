/**
 * 子命令 search：对记录库全部记录（frontmatter + 正文）做大小写不敏感的全文搜索。
 */
import { listAllRecords, displayPath } from './config.mjs';

export const usage = [
  '用法：node kiwi/scripts/kiwi.mjs search <keyword>',
  '',
  '说明：',
  '  对 records/ 下全部记录（frontmatter 与正文）做大小写不敏感的全文搜索，',
  '  输出命中文件的相对路径、行号与命中行内容，末尾汇总命中数量。',
].join('\n');

export async function run(args) {
  const keyword = args[0];
  if (!keyword || !String(keyword).trim()) {
    console.error('缺少关键词参数：<keyword>');
    console.error(usage);
    process.exit(1);
  }

  const kw = String(keyword).toLowerCase();
  let fileCount = 0;
  let hitCount = 0;

  for (const rec of listAllRecords()) {
    const hits = [];
    const lines = rec.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(kw)) hits.push([i + 1, lines[i].trim()]);
    }
    if (hits.length === 0) continue;
    fileCount += 1;
    hitCount += hits.length;
    for (const [no, text] of hits) console.log(`${displayPath(rec.absPath)}:${no}: ${text}`);
  }

  console.log(`\n共 ${fileCount} 个文件 ${hitCount} 处命中。`);
}
