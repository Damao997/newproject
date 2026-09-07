import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SummaryBreakdownPopover, SummaryBreakdownContent, type BreakdownColumn } from '@/components/summary/summary-breakdown'
import type { MemberValue } from '@/hooks/use-summary-member-values'
import type { MetricValue } from '@/lib/metric-values'

/** 构造成员取值（金额单位万元，2 位小数避免浮点尾差干扰断言） */
function mv(actual: number, ytd = actual): MetricValue {
  return { budget: 0, actual, samePeriod: 0, ytd, samePeriodYtd: 0 }
}

function member(code: string, name: string, value: MetricValue): MemberValue {
  return { code, name, value }
}

const singleCol: BreakdownColumn[] = [{ label: '本月实际', pick: (v) => v.actual, summaryValue: 100 }]

afterEach(() => {
  cleanup()
})

describe('SummaryBreakdownContent（成员明细卡内容）', () => {
  it('渲染成员明细行：名称 + 金额千分位两位小数', () => {
    const rows = [member('EN1', '杭州分公司', mv(12.5)), member('EN2', '宁波分公司', mv(87.5))]
    render(<SummaryBreakdownContent title="收入" columns={singleCol} rows={rows} />)
    expect(screen.getByText('杭州分公司')).toBeInTheDocument()
    expect(screen.getByText('宁波分公司')).toBeInTheDocument()
    expect(screen.getByText('12.50')).toBeInTheDocument()
    expect(screen.getByText('87.50')).toBeInTheDocument()
    expect(screen.getByLabelText('收入成员公司明细')).toBeInTheDocument()
  })

  it('差额行：Σ成员 ≠ 汇总值时显示汇总抵消调整，合计恒等于汇总值', () => {
    const rows = [member('EN1', '杭州分公司', mv(60)), member('EN2', '宁波分公司', mv(30))] // Σ=90，汇总=100
    const cols: BreakdownColumn[] = [{ label: '本月实际', pick: (v) => v.actual, summaryValue: 100 }]
    render(<SummaryBreakdownContent title="收入" columns={cols} rows={rows} />)
    expect(screen.getByText('汇总抵消调整')).toBeInTheDocument()
    expect(screen.getByText('10.00')).toBeInTheDocument() // 差额 100-90
    expect(screen.getByText('合计')).toBeInTheDocument()
    expect(screen.getByText('100.00')).toBeInTheDocument() // 合计=Σ+差额=汇总值
  })

  it('差额为 0 时不显示抵消调整行，仅显示成员合计', () => {
    const rows = [member('EN1', '杭州分公司', mv(60)), member('EN2', '宁波分公司', mv(40))]
    render(<SummaryBreakdownContent title="收入" columns={singleCol} rows={rows} />)
    expect(screen.queryByText('汇总抵消调整')).not.toBeInTheDocument()
    expect(screen.getByText('100.00')).toBeInTheDocument()
  })

  it('负差额显示为抵消（-10.00），合计仍对平汇总值', () => {
    const rows = [member('EN1', '杭州分公司', mv(105))]
    const cols: BreakdownColumn[] = [{ label: '本月实际', pick: (v) => v.actual, summaryValue: 95 }]
    render(<SummaryBreakdownContent title="收入" columns={cols} rows={rows} />)
    expect(screen.getByText('-10.00')).toBeInTheDocument()
    expect(screen.getByText('95.00')).toBeInTheDocument()
  })

  it('loading（rows=undefined）渲染骨架行，不渲染明细表', () => {
    render(<SummaryBreakdownContent title="收入" columns={singleCol} rows={undefined} />)
    expect(screen.getByLabelText('成员明细加载中')).toBeInTheDocument()
    expect(screen.queryByText('合计')).not.toBeInTheDocument()
  })

  it('rows 为空数组显示「成员公司暂无数据」', () => {
    render(<SummaryBreakdownContent title="收入" columns={singleCol} rows={[]} />)
    expect(screen.getByText('成员公司暂无数据')).toBeInTheDocument()
    expect(screen.queryByText('合计')).not.toBeInTheDocument()
  })

  it('failedCount > 0 显示加载失败提示行', () => {
    const rows = [member('EN1', '杭州分公司', mv(100))]
    render(<SummaryBreakdownContent title="收入" columns={singleCol} rows={rows} failedCount={2} />)
    expect(screen.getByText('2 家成员数据加载失败，明细可能不完整')).toBeInTheDocument()
  })

  it('双列（KPI 卡 本月实际+本年累计）：渲染表头，两列独立对平差额', () => {
    // 本月 Σ=90（汇总 100，差额+10）；累计 Σ=200（汇总 200，无差额）
    const rows = [member('EN1', '杭州分公司', mv(60, 120)), member('EN2', '宁波分公司', mv(30, 80))]
    const cols: BreakdownColumn[] = [
      { label: '本月实际', pick: (v) => v.actual, summaryValue: 100 },
      { label: '本年累计', pick: (v) => v.ytd, summaryValue: 200 },
    ]
    render(<SummaryBreakdownContent title="收入" columns={cols} rows={rows} />)
    expect(screen.getByText('成员公司')).toBeInTheDocument()
    expect(screen.getByText('本月实际')).toBeInTheDocument()
    expect(screen.getByText('本年累计')).toBeInTheDocument()
    expect(screen.getByText('120.00')).toBeInTheDocument()
    expect(screen.getByText('10.00')).toBeInTheDocument() // 仅本月列有差额
    expect(screen.getByText('200.00')).toBeInTheDocument()
  })

  it('比率类（valueType=ratio）：成员显示百分比格式，隐藏差额/合计行，显示口径说明', () => {
    // 成员自身毛利率 30%/40%；汇总值 35% 为公式重算（非 Σ成员 70%）
    const rows = [member('EN1', '杭州分公司', mv(0.3)), member('EN2', '宁波分公司', mv(0.4))]
    const cols: BreakdownColumn[] = [{ label: '本月实际', pick: (v) => v.actual, summaryValue: 0.35 }]
    render(<SummaryBreakdownContent title="壹品慧毛利率" columns={cols} rows={rows} valueType="ratio" />)
    expect(screen.getByText('30.0%')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    expect(screen.queryByText('汇总抵消调整')).not.toBeInTheDocument()
    expect(screen.queryByText('合计')).not.toBeInTheDocument()
    expect(screen.getByText(/比率为各成员公司自身口径，不可直接加总/)).toBeInTheDocument()
    expect(screen.getByText('本月实际（%）')).toBeInTheDocument()
  })

  it('数量类（valueType=quantity）：整数格式化，差额/合计逻辑保留', () => {
    // Σ=2,000，汇总 2,100（差额 100 户）
    const rows = [member('EN1', '杭州分公司', mv(1200)), member('EN2', '宁波分公司', mv(800))]
    const cols: BreakdownColumn[] = [{ label: '本月实际', pick: (v) => v.actual, summaryValue: 2100 }]
    render(<SummaryBreakdownContent title="直饮水接驳户数" columns={cols} rows={rows} valueType="quantity" />)
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('800')).toBeInTheDocument()
    expect(screen.getByText('汇总抵消调整')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('2,100')).toBeInTheDocument()
    expect(screen.getByText('本月实际（数量）')).toBeInTheDocument()
  })
})

describe('SummaryBreakdownPopover（悬浮触发）', () => {
  it('默认不渲染浮层内容，hover 触发元素后展示成员明细', async () => {
    const rows = [member('EN1', '杭州分公司', mv(100))]
    render(
      <SummaryBreakdownPopover title="收入" columns={singleCol} rows={rows}>
        <span>1,234.56</span>
      </SummaryBreakdownPopover>,
    )
    // 触发元素原样渲染，浮层未打开
    expect(screen.getByText('1,234.56')).toBeInTheDocument()
    expect(screen.queryByTestId('summary-breakdown-content')).not.toBeInTheDocument()

    // hover → 100ms 延迟后浮层出现（含 antd mouseEnterDelay）
    fireEvent.mouseEnter(screen.getByTestId('summary-breakdown-trigger'))
    await waitFor(() => expect(screen.getByTestId('summary-breakdown-content')).toBeInTheDocument(), { timeout: 600 })
    expect(screen.getByText('杭州分公司')).toBeInTheDocument()
  })

  it('鼠标移开后浮层自动隐藏', async () => {
    const rows = [member('EN1', '杭州分公司', mv(100))]
    render(
      <SummaryBreakdownPopover title="收入" columns={singleCol} rows={rows}>
        <span>1,234.56</span>
      </SummaryBreakdownPopover>,
    )
    const trigger = screen.getByTestId('summary-breakdown-trigger')
    fireEvent.mouseEnter(trigger)
    await waitFor(() => expect(screen.getByTestId('summary-breakdown-content')).toBeInTheDocument(), { timeout: 600 })
    fireEvent.mouseLeave(trigger)
    // antd 隐藏浮层默认不销毁 DOM（rc-trigger 保留节点），断言其不可见
    await waitFor(() => expect(screen.getByTestId('summary-breakdown-content')).not.toBeVisible(), { timeout: 600 })
  })

  it('loading 时浮层展示骨架而非明细', async () => {
    render(
      <SummaryBreakdownPopover title="收入" columns={singleCol} rows={undefined} loading>
        <span>1,234.56</span>
      </SummaryBreakdownPopover>,
    )
    fireEvent.mouseEnter(screen.getByTestId('summary-breakdown-trigger'))
    await waitFor(() => expect(screen.getByTestId('summary-breakdown-content')).toBeInTheDocument(), { timeout: 600 })
    expect(screen.getByLabelText('成员明细加载中')).toBeInTheDocument()
  })
})
