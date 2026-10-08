import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { MonthlyActivationImpact } from '../import-activation-impact'
import { UploadZone } from '../import-upload-zone'
import type { ImportActivationImpact } from '@/lib/api'

vi.mock('../use-import-flow', () => ({ errorColumns: [], templateTypeLabel: { operating: '经营数据', static: '静态数据', cashflow: '现金流量数据' } }))
const impact: ImportActivationImpact = {
  activeBatch: { id: 'old', filename: '旧报表.xlsx' }, newPeriods: [], overlappingPeriods: ['2026-08'], retainedPeriods: ['2026-08'],
  newCompanyPeriods: [{ companyCode: '乙公司', period: '2026-09' }], overlappingCompanyPeriods: [{ companyCode: '甲公司', period: '2026-08' }], retainedCompanyPeriods: [{ companyCode: '乙公司', period: '2026-08' }],
}
const preview = { dataRowCount: 1, errorCount: 0, operatingCount: 1, staticCount: 0, budgetCount: 0, errors: [], activationImpact: impact }
const noop = vi.fn()
const props: ComponentProps<typeof UploadZone> = {
  canImport: true, templateType: 'operating', setTemplateType: noop, valueUnit: 'wan', setValueUnit: noop, budgetFiscalYear: 'FY2026', setBudgetFyOverride: noop, fyOptions: ['FY2026'],
  selectedFile: null, fileError: null, setFileError: noop, previewResult: null, setPreviewResult: noop, mergedPreview: null,
  previewing: false, uploading: false, activating: false, uploadedInfo: null, selectedBatch: null, setImportOpen: noop,
  onFileSelect: noop, onDragOver: noop, onDrop: noop, onUpload: async () => {}, onCancel: noop, onPreview: async () => {}, onActivate: async () => {},
}

describe('公司月份激活影响提示', () => {
  it('同一个月份分别说明甲公司替换与乙公司保留', () => {
    render(<MonthlyActivationImpact impact={impact} />)
    expect(screen.getByText('将替换 1 个公司月份组合：甲公司 × 2026-08。')).toBeInTheDocument()
    expect(screen.getByText('继续保留 1 个公司月份组合：乙公司 × 2026-08。')).toBeInTheDocument()
    expect(screen.getByText(/同公司同月未包含的旧科目也会被替换/)).toBeInTheDocument()
  })
  it('空影响不显示范围提示', () => {
    const { container } = render(<MonthlyActivationImpact impact={{ activeBatch: null, newPeriods: [], overlappingPeriods: [], retainedPeriods: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('长列表可展开查看完整范围', () => {
    const keys = Array.from({ length: 8 }, (_, i) => ({ companyCode: '公司' + i, period: '2026-08' }))
    render(<MonthlyActivationImpact impact={{ ...impact, overlappingCompanyPeriods: keys }} />)
    const summary = screen.getByText('查看全部将替换范围')
    fireEvent.click(summary)
    expect(screen.getByText('公司7 × 2026-08')).toBeInTheDocument()
  })
  it('单文件预览展示真实组合', () => {
    render(<UploadZone {...props} previewResult={preview} />)
    expect(screen.getByText('将替换 1 个公司月份组合：甲公司 × 2026-08。')).toBeInTheDocument()
  })
  it('多表合并预览采用同一公司月份规则', () => {
    render(<UploadZone {...props} templateType="merged" mergedPreview={{ ignoredSheets: [], perType: { operating: { ...preview, detailCount: 1, sampleRows: { headers: [], rows: [] }, summary: { companyCount: 2, subjectCount: 1, periodRange: { min: '2026-08', max: '2026-09' }, totalValue: 0, zeroValueCount: 1, duplicateCount: 0, duplicateSamples: [] }, kpiCoverage: null } } }} />)
    expect(screen.getByText('将替换 1 个公司月份组合：甲公司 × 2026-08。')).toBeInTheDocument()
    expect(screen.getByText('继续保留 1 个公司月份组合：乙公司 × 2026-08。')).toBeInTheDocument()
  })
  it('年度预算仍然提示按财年替换', () => {
    render(<UploadZone {...props} templateType="budget" previewResult={{ ...preview, activationImpact: { activeBatch: impact.activeBatch, newPeriods: [], overlappingPeriods: ['FY2026'], retainedPeriods: [] } }} />)
    expect(screen.getByText('激活后将替换《旧报表.xlsx》的 FY2026 财年预算。')).toBeInTheDocument()
    expect(screen.queryByText(/按公司整月替换；/)).not.toBeInTheDocument()
  })
})
