import { Router, type Response } from 'express'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { recordAudit, clientIp } from '../middleware/audit'
import { AdminService } from '../services/AdminService'
import type { AuthUserContext } from '../types/express'

/**
 * 权限管理路由（/api/v1/admin）。权限：admin:users:* / admin:roles:* / admin:permissions:*。
 */
const router = Router()

function ctxOf(req: { authUser?: AuthUserContext; traceId: string }) {
  return { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }
}
function pageParams(q: Record<string, unknown>) {
  const page = Math.max(Number(q.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 1000)
  return { page, pageSize }
}
function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(buffer)
}

router.use(authenticate)

// ===== 用户 =====
router.get('/users', requirePermission('admin:users:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  sendOk(res, await AdminService.listUsers({ page, pageSize, keyword: req.query.keyword as string | undefined }))
}))

router.get('/users/export', requirePermission('admin:users:export', 'export'), asyncHandler(async (req, res) => {
  const buffer = await AdminService.exportUsers()
  await recordAudit({ userId: (req.authUser as AuthUserContext).userId, module: 'admin', action: 'export', targetId: 'users', ip: clientIp(req) }, req.traceId)
  sendXlsx(res, buffer, 'admin-users.xlsx')
}))

router.post('/users', requirePermission('admin:users:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.username || !b.password || !b.role) throw errors.badRequest('用户名、密码、角色必填')
  sendOk(res, await AdminService.createUser(b, ctxOf(req)))
}))

router.put('/users/:id', requirePermission('admin:users:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await AdminService.updateUser(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/users/:id', requirePermission('admin:users:delete', 'delete'), asyncHandler(async (req, res) => {
  await AdminService.disableUser(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

router.post('/users/:id/reset-password', requirePermission('admin:users:reset-password', 'update'), asyncHandler(async (req, res) => {
  const newPassword = String(req.body?.newPassword ?? '')
  await AdminService.resetPassword(req.params.id as string, newPassword, ctxOf(req))
  sendOk(res, null)
}))

// ===== 角色 =====
router.get('/roles', requirePermission('admin:roles:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await AdminService.listRoles())
}))

router.post('/roles', requirePermission('admin:roles:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.name) throw errors.badRequest('角色编码与名称必填')
  sendOk(res, await AdminService.createRole(b, ctxOf(req)))
}))

router.put('/roles/:id', requirePermission('admin:roles:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await AdminService.updateRole(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/roles/:id', requirePermission('admin:roles:delete', 'delete'), asyncHandler(async (req, res) => {
  await AdminService.deleteRole(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

router.post('/roles/:id/clone', requirePermission('admin:roles:create', 'create'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '')
  if (!name) throw errors.badRequest('克隆角色名称必填')
  sendOk(res, await AdminService.cloneRole(req.params.id as string, name, ctxOf(req)))
}))

router.put('/roles/:id/permissions', requirePermission('admin:permissions:update', 'update'), asyncHandler(async (req, res) => {
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : []
  await AdminService.updateRolePermissions(req.params.id as string, permissions, ctxOf(req))
  sendOk(res, null)
}))

// ===== 权限 =====
router.get('/permissions', requirePermission('admin:permissions:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await AdminService.listPermissions())
}))

// ===== 审计日志 =====
router.get('/audit-logs', requirePermission('admin:users:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  sendOk(res, await AdminService.listAuditLogs({ page, pageSize, module: req.query.module as string | undefined, action: req.query.action as string | undefined }))
}))

export default router
