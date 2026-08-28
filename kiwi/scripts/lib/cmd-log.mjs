/**
 * 子命令 log：按记录 id 定位文件，输出其 Git 提交历史（版本演变追踪）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { KIWI_ROOT, findRecordById, displayPath } from './config.mjs';

export const usage = [
  '用法：node kiwi/scripts/kiwi.mjs log <id>',
  '',
  '说明：',
  '  按记录 id 定位记录文件，在 Git 仓库根执行 git log --follow 展示其提交历史',
  '  （短 hash、日期、作者、提交信息首行，按时间倒序）。',
].join('\n');

const LOG_SEP = '===KIWI-LOG-END===';

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

  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: KIWI_ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error('未找到 git 命令：请确认已安装 Git 并加入 PATH。');
      process.exit(1);
    }
    console.error('未能定位 Git 仓库根：请确认 kiwi 目录位于 Git 仓库内。');
    process.exit(1);
  }

  const relPath = path.relative(gitRoot, rec.absPath).split(path.sep).join('/');

  let out;
  try {
    out = execFileSync(
      'git',
      ['log', '--follow', '--date=short', `--format=%h%n%ad%n%an%n%s%n${LOG_SEP}`, '--', relPath],
      { cwd: gitRoot, encoding: 'utf8' },
    );
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error('未找到 git 命令：请确认已安装 Git 并加入 PATH。');
      process.exit(1);
    }
    // 文件从未提交（无该路径的历史）时 git log 以 128 退出，视为尚无演变记录
    if (err && err.status === 128) {
      console.log('该记录尚无 Git 提交历史，请先提交后查看演变。');
      return;
    }
    throw err;
  }

  if (!out.trim()) {
    console.log('该记录尚无 Git 提交历史，请先提交后查看演变。');
    return;
  }

  console.log(`记录 ${id} 的 Git 演变历史（按时间倒序）：`);
  console.log(`文件：${displayPath(rec.absPath)}`);
  console.log('');
  let count = 0;
  for (const seg of out.split(LOG_SEP)) {
    const lines = seg.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const [hash = '', date = '', author = '', subject = ''] = lines;
    count += 1;
    console.log(`${hash}  ${date}  ${author}  ${subject}`);
  }
  console.log(`\n共 ${count} 次提交。`);
}
