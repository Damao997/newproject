/**
 * 往来对象（客商）关联方分类。
 *
 * 三分类口径：
 *  - internal（内部公司）：客商名称命中分析体系公司主数据（现有 isInternal 判定）；
 *  - related（关联方）：客商编码为 6 位纯数字且未命中公司主数据（ERP 下发的内部单位码段，但不在分析体系内）；
 *  - external（外部）：其余客商（如 C 前缀客户码、S 前缀供应商码）。
 *
 * 该函数是唯一分类来源，导入写入、存量回填、查询过滤共用，保证口径一致。
 */

export type PartyType = 'internal' | 'related' | 'external'

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  internal: '内部公司',
  related: '关联方',
  external: '外部',
}

export function derivePartyType(isInternal: boolean, counterpartyCode: string | null | undefined): PartyType {
  if (isInternal) return 'internal'
  if (/^\d{6}$/.test(counterpartyCode ?? '')) return 'related'
  return 'external'
}
