import { describe, expect, it } from 'vitest'
import { defaultPreferences, preferencesSchema, preferencePatchSchema, profilePatchSchema } from '../personal-settings'
describe('个人设置输入白名单', () => {
  it('默认值覆盖所有设置，布尔值不能使用字符串', () => {
    expect(preferencesSchema.parse(defaultPreferences)).toEqual(defaultPreferences)
    expect(preferencesSchema.safeParse({ ...defaultPreferences, showShortName: 'true' }).success).toBe(false)
  })
  it('个人资料不能写入权限、登录名或用户编号', () => {
    for (const key of ['roleId', 'username', 'userId', 'dataScopeCodes']) expect(profilePatchSchema.safeParse({ name: '测试姓名', [key]: '测试值' }).success).toBe(false)
  })
  it('资料允许清空选填字段，姓名与邮箱校验明确', () => {
    expect(profilePatchSchema.parse({ name: '  测试姓名  ', email: '', phone: null })).toEqual({ name: '测试姓名', email: '', phone: null })
    expect(profilePatchSchema.safeParse({ name: ' ' }).success).toBe(false)
    expect(profilePatchSchema.safeParse({ email: 'bad' }).success).toBe(false)
  })
  it('偏好补丁需要版本，并拒绝未知字段和非法选项', () => {
    expect(preferencePatchSchema.safeParse({ changes: { theme: 'light' } }).success).toBe(false)
    expect(preferencePatchSchema.safeParse({ revision: 0, changes: { permission: 'all' } }).success).toBe(false)
    expect(preferencePatchSchema.safeParse({ revision: 0, changes: { indicatorDensity: 'unknown' } }).success).toBe(false)
  })
})
