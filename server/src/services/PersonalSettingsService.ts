import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { resolveScope } from '../middleware/scope'
import { AuthService } from './AuthService'
import { defaultPreferences, preferencesSchema, preferencePatchSchema, profilePatchSchema, personalHomeRoutes } from '../lib/personal-settings'
import type { AuthUserContext } from '../types/express'

const avatarDirectory = path.resolve(process.cwd(), 'uploads/avatars')
type Meta = { traceId?: string; ip?: string | null; userAgent?: string | null }
async function audit(userId: string, action: string, meta: Meta) {
  await recordAudit({ userId, module: 'auth', action, targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, meta.traceId)
}
async function visibleCompanies(user: AuthUserContext) {
  const scope = await resolveScope(prisma, user)
  const codes = scope.type === 'companies' ? [...scope.companyCodes, ...scope.summaryCodes] : []
  return prisma.company.findMany({ where: { status: 'active', ...(scope.type === 'all' ? {} : { code: { in: codes } }) }, select: { code: true, entityType: true } })
}
async function deleteAvatarFile(key: string | null) {
  if (!key) return
  try { await unlink(path.join(avatarDirectory, key)) }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') console.error('清理头像文件失败', { code: (cause as NodeJS.ErrnoException).code }) }
}

export const PersonalSettingsService = {
  async updateProfile(userId: string, input: unknown, meta: Meta) {
    const parsed = profilePatchSchema.parse(input)
    const { name, ...contacts } = parsed
    const normalized = Object.fromEntries(Object.entries(contacts).map(([key, value]) => [key, value || null]))
    try { await prisma.user.update({ where: { id: userId }, data: { ...(name === undefined ? {} : { displayName: name }), ...normalized } }) }
    catch (cause) { console.error('个人资料写入失败', { traceId: meta.traceId, code: (cause as { code?: string }).code }); throw errors.internal('资料保存失败，请重试') }
    await audit(userId, 'profile_update', meta)
    return AuthService.getProfile(userId)
  },
  async getPreferences(user: AuthUserContext) {
    const row = await prisma.userPreference.findUnique({ where: { userId: user.userId } })
    const parsed = preferencesSchema.safeParse(row?.preferences)
    const preferences = { ...(parsed.success ? parsed.data : defaultPreferences) }
    const companies = await visibleCompanies(user)
    const visible = new Set(companies.map(c => c.code))
    preferences.favoriteCompanies = preferences.favoriteCompanies.filter(c => visible.has(c))
    preferences.defaultCompanies = preferences.defaultCompanies.filter(c => visible.has(c))
    const types = preferences.defaultCompanies.map(code => companies.find(c => c.code === code)?.entityType)
    if (types.includes('summary') && (types.includes('single') || types.filter(type => type === 'summary').length > 1)) preferences.defaultCompanies = []
    if (preferences.companyStartup === 'fixed' && !preferences.defaultCompanies.length) preferences.companyStartup = 'remember'
    const profile = await AuthService.getProfile(user.userId)
    if (preferences.homePath !== 'auto' && !profile.permissions.includes(personalHomeRoutes[preferences.homePath])) preferences.homePath = 'auto'
    return { preferences, revision: row?.revision ?? 0 }
  },
  async updatePreferences(user: AuthUserContext, input: unknown, meta: Meta) {
    const patch = preferencePatchSchema.parse(input)
    const current = await this.getPreferences(user)
    if (patch.revision !== current.revision) throw errors.conflict('设置已在其他设备更新，请重新载入或确认重新提交')
    const preferences = preferencesSchema.parse({ ...current.preferences, ...patch.changes })
    const visible = await visibleCompanies(user)
    const visibleCodes = new Set(visible.map(c => c.code))
    if ([...preferences.favoriteCompanies, ...preferences.defaultCompanies].some(c => !visibleCodes.has(c))) throw errors.forbidden('所选公司已失效或不在您的数据范围内')
    preferences.favoriteCompanies = [...new Set(preferences.favoriteCompanies)]
    preferences.defaultCompanies = [...new Set(preferences.defaultCompanies)]
    if (preferences.companyStartup === 'fixed' && !preferences.defaultCompanies.length) throw errors.badRequest('请选择默认公司范围')
    const types = preferences.defaultCompanies.map(code => visible.find(c => c.code === code)?.entityType)
    if (types.includes('summary') && (types.includes('single') || types.filter(t => t === 'summary').length > 1)) throw errors.badRequest('默认范围只能选择单体公司，或一个汇总主体')
    const profile = await AuthService.getProfile(user.userId)
    if (preferences.homePath !== 'auto' && (!personalHomeRoutes[preferences.homePath] || !profile.permissions.includes(personalHomeRoutes[preferences.homePath]))) throw errors.forbidden('默认入口不可访问')
    try {
      await prisma.$transaction(async tx => {
        if (patch.revision === 0) {
          await tx.userPreference.create({ data: { userId: user.userId, preferences, revision: 1 } })
        } else {
          const result = await tx.userPreference.updateMany({ where: { userId: user.userId, revision: patch.revision }, data: { preferences, revision: { increment: 1 } } })
          if (result.count !== 1) throw errors.conflict('设置已在其他设备更新，请重新载入或确认重新提交')
        }
      })
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') throw errors.conflict('设置已在其他设备更新，请重新载入或确认重新提交')
      throw cause
    }
    await audit(user.userId, 'preferences_update', meta)
    return { preferences, revision: patch.revision + 1 }
  },
  async getAvatar(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } })
    if (!user?.avatarKey) throw errors.notFound('尚未设置头像')
    return readFile(path.join(avatarDirectory, user.avatarKey))
  },
  async updateAvatar(userId: string, file: Express.Multer.File | undefined, meta: Meta) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > 2 * 1024 * 1024) throw errors.badRequest('请选择 2MB 以内的 JPEG、PNG 或 WebP 图片')
    let buffer: Buffer
    try {
      const image = sharp(file.buffer, { limitInputPixels: 16_000_000, animated: false })
      const metadata = await image.metadata()
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('图片格式不支持')
      buffer = await image.rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
    } catch { throw errors.badRequest('图片无法读取，请更换有效的 JPEG、PNG 或 WebP 图片') }
    const key = randomUUID() + '.webp'
    await mkdir(avatarDirectory, { recursive: true })
    let oldKey: string | null = null
    try {
      await writeFile(path.join(avatarDirectory, key), buffer, { flag: 'wx' })
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
        oldKey = user.avatarKey
        await tx.user.update({ where: { id: userId }, data: { avatarKey: key } })
      })
    } catch (cause) { await deleteAvatarFile(key); throw cause }
    await deleteAvatarFile(oldKey)
    await audit(userId, 'avatar_update', meta)
    return AuthService.getProfile(userId)
  },
  async removeAvatar(userId: string, meta: Meta) {
    let oldKey: string | null = null
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      oldKey = user.avatarKey
      await tx.user.update({ where: { id: userId }, data: { avatarKey: null } })
    })
    await deleteAvatarFile(oldKey)
    await audit(userId, 'avatar_remove', meta)
    return AuthService.getProfile(userId)
  },
}
