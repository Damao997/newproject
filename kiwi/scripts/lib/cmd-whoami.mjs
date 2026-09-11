/**
 * 子命令 whoami：输出当前身份与识别到的角色（未登记时明确提示）。
 */
import { getCurrentUser, getRole, ROLE_DESC } from './perm.mjs';

export async function run() {
  const user = getCurrentUser();
  if (!user) {
    console.log('当前身份：（未能识别）');
    console.log('说明：未设置环境变量 KIWI_USER，且未能通过 git config user.name 获取身份。');
    return;
  }
  const role = getRole(user);
  if (!role) {
    console.log(`当前身份：${user}`);
    console.log('识别角色：（未登记）');
    console.log('提示：当前身份未在 config/roles.json 中登记，请联系维护人（admin）添加后再使用写操作。');
    return;
  }
  console.log(`当前身份：${user}`);
  console.log(`识别角色：${role}（${ROLE_DESC[role] || '未定义权限的角色'}）`);
}
