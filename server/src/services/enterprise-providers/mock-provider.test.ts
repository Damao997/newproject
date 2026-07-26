import { describe, it, expect } from 'vitest'
import { mockProvider, MOCK_ENTERPRISES, generateMockEnterprise } from './mock-provider'

describe('mockProvider.search', () => {
  it('信用代码精确匹配内置企业', async () => {
    const target = MOCK_ENTERPRISES[0]
    const result = await mockProvider.search(target.creditCode)
    expect(result?.name).toBe(target.name)
    expect(result?.creditCode).toBe(target.creditCode)
  })

  it('名称精确匹配内置企业', async () => {
    const target = MOCK_ENTERPRISES[1]
    const result = await mockProvider.search(target.name)
    expect(result?.creditCode).toBe(target.creditCode)
  })

  it('名称模糊（包含）匹配内置企业', async () => {
    const result = await mockProvider.search('云帆')
    expect(result?.name).toBe('杭州云帆网络科技有限公司')
  })

  it('空关键词返回 null', async () => {
    expect(await mockProvider.search('   ')).toBeNull()
  })

  it('未命中时确定性生成：同一输入两次结果一致', async () => {
    const a = await mockProvider.search('某某测试贸易有限公司')
    const b = await mockProvider.search('某某测试贸易有限公司')
    expect(a).toEqual(b)
    expect(a?.name).toBe('某某测试贸易有限公司')
    expect(a?.raw).toMatchObject({ mockGenerated: true })
  })

  it('生成数据字段完整（信用代码 18 位、日期格式合法）', () => {
    const info = generateMockEnterprise('演示公司')
    expect(info.creditCode).toHaveLength(18)
    expect(info.establishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(info.status).toBeTruthy()
    expect(info.registeredCapital).toBeTruthy()
  })
})
