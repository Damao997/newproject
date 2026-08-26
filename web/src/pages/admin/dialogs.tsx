// re-export 入口：admin 对话框按职责拆分至 ./dialogs/*（调用方 users.tsx/roles.tsx 路径不变）
export { UserDialog } from './dialogs/user-dialog'
export { RoleDialog } from './dialogs/role-dialog'
export { PermissionDialog } from './dialogs/permission-dialog'
export { BatchPermissionDialog } from './dialogs/batch-permission-dialog'
export { CloneRoleDialog } from './dialogs/clone-role-dialog'
export { ResetPasswordDialog } from './dialogs/reset-password-dialog'
