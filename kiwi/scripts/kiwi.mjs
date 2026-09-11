#!/usr/bin/env node
/**
 * kiwi 知识库 CLI 入口：仅负责参数解析与子命令分发。
 * 新增子命令：在 scripts/lib/ 下新增 cmd-<name>.mjs（导出 run(args)），并在 COMMANDS 注册一行即可。
 */

const COMMANDS = {
  new: './lib/cmd-new.mjs',
  validate: './lib/cmd-validate.mjs',
  whoami: './lib/cmd-whoami.mjs',
  list: './lib/cmd-list.mjs',
  search: './lib/cmd-search.mjs',
  show: './lib/cmd-show.mjs',
  log: './lib/cmd-log.mjs',
};

const USAGE = [
  'kiwi 知识库 CLI（纯本地 · 零第三方运行时依赖）',
  '',
  '用法：node kiwi/scripts/kiwi.mjs <子命令> [参数]',
  '',
  '可用子命令：',
  ...Object.keys(COMMANDS).map((c) => `  ${c}`),
  '',
  '示例：',
  '  node kiwi/scripts/kiwi.mjs whoami',
  '  node kiwi/scripts/kiwi.mjs new --project=fy200-clone --type=fix --title="修复登录超时" --owner=张三 --reason="登录易超时" --files=web/src/a.ts',
  '  node kiwi/scripts/kiwi.mjs validate',
].join('\n');

const [, , command, ...rest] = process.argv;

if (!command || command === '-h' || command === '--help' || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}

const modulePath = COMMANDS[command];
if (!modulePath) {
  console.error(`未知子命令：${command}`);
  console.error(`可用子命令：${Object.keys(COMMANDS).join('、')}`);
  console.error('查看帮助：node kiwi/scripts/kiwi.mjs --help');
  process.exit(1);
}

try {
  const mod = await import(modulePath);
  if (typeof mod.run !== 'function') {
    console.error(`子命令模块损坏：${modulePath} 未导出 run()`);
    process.exit(1);
  }
  await mod.run(rest);
} catch (err) {
  console.error(`执行出错：${err && err.message ? err.message : err}`);
  process.exit(1);
}
