import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricTree } from '@/components/subject-tree/metric-tree'
import type { SubjectNode } from '@/types'
import type { MetricValue } from '@/lib/metric-values'

/**
 * MetricTree 展示类（display）行渲染规范：展示类只读展示、不参与计算，
 * 即使后端值映射存在也不显示数值，值列统一渲染「—」（全站口径，与 browse/后端 maskDisplayRows 一致）。
 */

function node(overrides: Partial<SubjectNode> & { code: string; name: string }): SubjectNode {
  return {
    level: 0,
    category: '经营成果',
    dataType: 'data',
    valueType: 'amount',
    children: [],
    ...overrides,
  }
}

const valueMap = (v: Partial<MetricValue> = {}): Map<string, MetricValue> =>
  new Map([['PL06', { budget: 100, actual: 400, samePeriod: 300, ytd: 1200, samePeriodYtd: 900, ...v }]])

const baseProps = {
  variant: 'operating' as const,
  expandedCodes: new Set<string>(),
  onToggle: () => {},
}

describe('MetricTree 展示类行', () => {
  it('展示类节点即使有值映射也不显示数值，值列统一渲染「—」', () => {
    render(
      <MetricTree
        {...baseProps}
        nodes={[node({ code: 'PL06', name: '经营成果', dataType: 'display' })]}
        valueMap={valueMap()}
      />,
    )
    // 经营 8 个值列全部为「—」：预算/本月实际/同期实际/同比/本年累计/同期累计/累计同比/达成率
    expect(screen.getAllByText('—')).toHaveLength(8)
    // 数值不得出现
    expect(screen.queryByText('400.00')).toBeNull()
    expect(screen.queryByText('1,200.00')).toBeNull()
  })

  it('数据类节点正常显示数值（回归）', () => {
    render(
      <MetricTree
        {...baseProps}
        nodes={[node({ code: 'PL06', name: '壹品慧净利润', dataType: 'data' })]}
        valueMap={valueMap()}
      />,
    )
    expect(screen.getByText('400.00')).toBeInTheDocument()
    expect(screen.getByText('1,200.00')).toBeInTheDocument()
  })
})

describe('MetricTree 首列冻结（横向滚动吸附）', () => {
  /**
   * 回归：首列数据单元格曾只有裸 `sticky` 而无 `left` 偏移（position: sticky 的 inset 为 auto 时不产生吸附位移），
   * 横向滚动时科目列随内容移出视口被裁切成名称后缀，而表头「科目」因带 left-0 仍吸附 → 头体错位。
   * 表头与数据单元格必须都显式指定 left-0，保持冻结行为一致。
   */
  it('经营指标表头「科目」与数据行首列的 sticky 左偏移保持一致', () => {
    render(
      <MetricTree
        {...baseProps}
        nodes={[node({ code: 'PL06', name: '厨房产品销售收入（不含净水及服务）', dataType: 'data' })]}
        valueMap={valueMap()}
      />,
    )
    const header = screen.getByRole('columnheader', { name: '科目' })
    const cell = screen.getByText('厨房产品销售收入（不含净水及服务）').closest('td')!
    for (const el of [header, cell]) {
      expect(el.className).toContain('sticky')
      expect(el.className).toContain('left-0')
    }
  })
})
