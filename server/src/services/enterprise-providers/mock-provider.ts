import type { EnterpriseBasicInfo, EnterpriseInfoProvider } from './types'

/**
 * Mock Provider：无需外部 API Key 的开发/演示数据源。
 * 内置若干典型企业（含在业/注销/吊销状态），支持名称模糊与信用代码精确匹配；
 * 未命中时基于 keyword 确定性生成一条模拟数据，保证任何输入都可演示。
 */

/** 内置模拟企业清单 */
export const MOCK_ENTERPRISES: EnterpriseBasicInfo[] = [
  {
    name: '杭州云帆网络科技有限公司',
    creditCode: '91330106MA2CE7XW08',
    legalPerson: '陈建国',
    registeredCapital: '1000万元人民币',
    establishDate: '2016-03-18',
    status: '在业',
    companyType: '有限责任公司(自然人投资或控股)',
    industry: '软件和信息技术服务业',
    registeredAddress: '浙江省杭州市西湖区文三路 258 号 5 幢 401 室',
    businessScope: '技术开发、技术服务、技术咨询、成果转让：计算机软硬件、网络技术；服务：计算机系统集成，企业管理咨询。',
    raw: null,
  },
  {
    name: '宁波恒信贸易有限公司',
    creditCode: '91330201MA2AF3KQ21',
    legalPerson: '王丽萍',
    registeredCapital: '500万元人民币',
    establishDate: '2012-07-05',
    status: '在业',
    companyType: '有限责任公司(自然人独资)',
    industry: '批发业',
    registeredAddress: '浙江省宁波市海曙区中山西路 168 号',
    businessScope: '日用百货、纺织品、服装、家用电器、五金交电的批发、零售；自营和代理各类货物和技术的进出口业务。',
    raw: null,
  },
  {
    name: '上海晟华建筑工程有限公司',
    creditCode: '91310114MA1GT8Y542',
    legalPerson: '刘志强',
    registeredCapital: '5000万元人民币',
    establishDate: '2008-11-20',
    status: '在业',
    companyType: '有限责任公司',
    industry: '房屋建筑业',
    registeredAddress: '上海市嘉定区曹安公路 4800 号 2 层',
    businessScope: '建筑工程施工总承包，市政公用建设工程施工，建筑装饰装修建设工程设计与施工，机电设备安装。',
    raw: null,
  },
  {
    name: '深圳市蓝海电子有限公司',
    creditCode: '91440300MA5EC9TD3X',
    legalPerson: '黄海涛',
    registeredCapital: '200万元人民币',
    establishDate: '2015-05-12',
    status: '注销',
    companyType: '有限责任公司',
    industry: '计算机、通信和其他电子设备制造业',
    registeredAddress: '广东省深圳市南山区科技园中区科苑路 15 号',
    businessScope: '电子产品、通讯设备的技术开发与销售；国内贸易；货物及技术进出口。',
    raw: null,
  },
  {
    name: '北京华信达咨询服务有限公司',
    creditCode: '91110105MA01C2GL66',
    legalPerson: '张伟',
    registeredCapital: '100万元人民币',
    establishDate: '2017-09-01',
    status: '吊销，未注销',
    companyType: '有限责任公司(自然人投资或控股)',
    industry: '商务服务业',
    registeredAddress: '北京市朝阳区建国路 88 号 12 层 1208',
    businessScope: '企业管理咨询；经济贸易咨询；市场调查；会议服务；承办展览展示活动。',
    raw: null,
  },
  {
    name: '成都锦程物流有限公司',
    creditCode: '91510107MA61R4BW9K',
    legalPerson: '李国芳',
    registeredCapital: '800万元人民币',
    establishDate: '2010-04-26',
    status: '存续',
    companyType: '有限责任公司',
    industry: '道路运输业',
    registeredAddress: '四川省成都市武侯区武科东三路 9 号',
    businessScope: '普通货物道路运输；仓储服务（不含危险品）；装卸搬运；供应链管理服务。',
    raw: null,
  },
]

/** 统一社会信用代码形态：18 位数字/大写字母 */
const CREDIT_CODE_RE = /^[0-9A-Z]{18}$/

/** 基于字符串生成确定性正整数（同一输入总是同一输出） */
function hashOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h
}

/** 未命中内置清单时，按 keyword 确定性生成一条模拟企业 */
export function generateMockEnterprise(keyword: string): EnterpriseBasicInfo {
  const h = hashOf(keyword)
  const statuses = ['在业', '在业', '在业', '存续', '注销'] // 偏向在业
  const industries = ['批发业', '软件和信息技术服务业', '商务服务业', '零售业', '制造业']
  const capitals = ['50万元人民币', '100万元人民币', '300万元人民币', '500万元人民币', '1000万元人民币']
  const isCode = CREDIT_CODE_RE.test(keyword)
  const name = isCode ? `模拟企业（${keyword.slice(0, 6)}）有限公司` : keyword
  // 生成形似信用代码的 18 位串（91 开头，明显标注为模拟数据）
  const creditCode = isCode ? keyword : `91${String(h).padStart(8, '0').slice(0, 8)}MOCK${String(h % 10000).padStart(4, '0')}`
  const year = 2005 + (h % 18)
  const month = String((h % 12) + 1).padStart(2, '0')
  const day = String((h % 28) + 1).padStart(2, '0')
  return {
    name,
    creditCode,
    legalPerson: ['张三', '李四', '王五', '赵六'][h % 4],
    registeredCapital: capitals[h % capitals.length],
    establishDate: `${year}-${month}-${day}`,
    status: statuses[h % statuses.length],
    companyType: '有限责任公司',
    industry: industries[h % industries.length],
    registeredAddress: '（模拟数据）浙江省杭州市上城区示例路 1 号',
    businessScope: '（模拟数据）一般项目：企业管理咨询；货物进出口；技术服务、技术开发。',
    raw: { mockGenerated: true, keyword },
  }
}

export const mockProvider: EnterpriseInfoProvider = {
  name: 'mock',

  async search(keyword: string): Promise<EnterpriseBasicInfo | null> {
    const kw = keyword.trim()
    if (!kw) return null
    // 1) 信用代码精确匹配
    if (CREDIT_CODE_RE.test(kw)) {
      const hit = MOCK_ENTERPRISES.find((e) => e.creditCode === kw)
      if (hit) return { ...hit }
    }
    // 2) 名称精确 → 模糊（包含）匹配
    const exact = MOCK_ENTERPRISES.find((e) => e.name === kw)
    if (exact) return { ...exact }
    const fuzzy = MOCK_ENTERPRISES.find((e) => e.name.includes(kw))
    if (fuzzy) return { ...fuzzy }
    // 3) 兜底：确定性生成，保证演示可用
    return generateMockEnterprise(kw)
  },
}
