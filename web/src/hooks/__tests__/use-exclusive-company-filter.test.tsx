import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
import type { Company } from '@/types'

const ENTITY = { code: 'C1', type: 'entity' } as unknown as Company
const SUMMARY = { code: 'S1', type: 'summary' } as unknown as Company

function Host({ companies, prev }: { companies: Company[]; prev: string[] }) {
  const setSelected = vi.fn()
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => prev,
    setSelected,
  })
  return (
    <div>
      <button onClick={() => handleCompaniesChange(['C1', 'S1'])}>勾选 C1+S1</button>
      <button onClick={() => handleCompaniesChange(['S1'])}>勾选 S1</button>
      {noticeElement}
    </div>
  )
}

describe('useExclusiveCompanyFilter 主体互斥过滤', () => {
  it('新增单体时自动移除已选汇总主体并以轻提示告知', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['S1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 C1+S1' }))
    expect(screen.getByText('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')).toBeInTheDocument()
  })

  it('新增汇总时自动移除已选单体公司并以轻提示告知', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['C1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 C1+S1' }))
    expect(screen.getByText('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')).toBeInTheDocument()
  })

  it('无冲突时直接透传选择结果，不出现提示', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['C1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 S1' }))
    expect(screen.queryByText(/不能同时筛选/)).not.toBeInTheDocument()
  })
})
