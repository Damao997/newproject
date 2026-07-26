import { loadConfig } from '../../config/env'
import { errors } from '../../lib/errors'
import { mockProvider } from './mock-provider'
import type { EnterpriseInfoProvider } from './types'

export type { EnterpriseBasicInfo, EnterpriseInfoProvider } from './types'

/**
 * Provider 工厂：按 ENTERPRISE_INFO_PROVIDER 返回数据源实例。
 * 接入真实厂商（tianyancha/qichacha 等）时：新增实现文件并在此注册即可，
 * 上层 EnterpriseInfoService 无需改动。
 */
export function getProvider(): EnterpriseInfoProvider {
  const config = loadConfig()
  switch (config.enterpriseInfoProvider) {
    case 'mock':
      return mockProvider
    default:
      throw errors.badRequest(`未支持的工商信息数据源：${config.enterpriseInfoProvider}`)
  }
}
