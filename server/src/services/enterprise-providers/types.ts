/**
 * 企业工商信息查询 Provider 统一契约。
 * 外部厂商（天眼查/企查查/聚合接口等）各自实现本接口并在工厂注册，
 * 上层 EnterpriseInfoService 只依赖统一 DTO，与具体厂商解耦。
 */

/** 统一的企业工商基础信息 DTO */
export interface EnterpriseBasicInfo {
  /** 企业名称 */
  name: string
  /** 统一社会信用代码 */
  creditCode: string
  /** 法定代表人 */
  legalPerson: string | null
  /** 注册资本（原样字符串，如 "5000万元人民币"） */
  registeredCapital: string | null
  /** 成立日期 YYYY-MM-DD */
  establishDate: string | null
  /** 经营状态（在业/存续/注销/吊销等） */
  status: string | null
  /** 企业类型 */
  companyType: string | null
  /** 所属行业 */
  industry: string | null
  /** 注册地址 */
  registeredAddress: string | null
  /** 经营范围 */
  businessScope: string | null
  /** 厂商原始返回（落库备查） */
  raw: Record<string, unknown> | null
}

/** Provider 接口：按关键词（企业名称或统一社会信用代码）查询单个企业 */
export interface EnterpriseInfoProvider {
  /** Provider 标识（落库 provider 字段），如 mock/tianyancha */
  readonly name: string
  /** 查询企业，未命中返回 null */
  search(keyword: string): Promise<EnterpriseBasicInfo | null>
}
