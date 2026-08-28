/**
 * 权限模块（本地约定层）：识别当前身份 → 匹配 roles.json 角色 → 判定写权限。
 * 说明：纯本地方案无服务端强制力，此处校验属约定性质，强管控需配合 Git 分支保护等外部机制。
 */
import { execFileSync } from 'node:child_process';
import { loadRoles, KIWI_ROOT } from './config.mjs';

const WRITABLE_ROLES = new Set(['admin', 'editor']);

export const ROLE_DESC = {
  admin: '全部权限',
  editor: '可创建、编辑记录',
  viewer: '只读',
};

/** 当前身份：优先环境变量 KIWI_USER，否则 git config user.name；均不可用返回 null */
export function getCurrentUser() {
  const fromEnv = process.env.KIWI_USER;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  try {
    const out = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf8',
      cwd: KIWI_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 按 roles.json 匹配角色；未登记返回 null */
export function getRole(name) {
  if (!name) return null;
  const roles = loadRoles();
  const users = Array.isArray(roles.users) ? roles.users : [];
  const hit = users.find((u) => u && u.name === name);
  return hit ? hit.role : null;
}

/** 该角色是否可执行写操作（new 等） */
export function canWrite(role) {
  return typeof role === 'string' && WRITABLE_ROLES.has(role);
}

/**
 * 写操作门禁：不通过时打印中文原因并 exit 1；通过返回 { user, role }。
 */
export function requireWriter() {
  const user = getCurrentUser();
  if (!user) {
    console.error('身份未登记（当前身份：未能识别），请联系 roles.json 维护人（admin）添加后重试');
    console.error('说明：未设置环境变量 KIWI_USER，且 git config user.name 不可用。');
    process.exit(1);
  }
  const role = getRole(user);
  if (!role) {
    console.error(`身份未登记（当前身份：${user}），请联系 roles.json 维护人（admin）添加后重试`);
    process.exit(1);
  }
  if (!canWrite(role)) {
    console.error(`权限不足：${role} 为只读角色`);
    process.exit(1);
  }
  return { user, role };
}
