import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { DateRangePicker, disableAfter, disableBefore, toDateDay, toDateStr } from '../date-range-picker'

describe('DateRangePicker（日期范围选择器）', () => {
  it('受控回显：传入 YYYY-MM-DD 字符串对时两端输入框显示对应值', () => {
    render(<DateRangePicker startDate="2026-09-01" endDate="2026-09-02" onChange={() => {}} />)
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2026-09-01')
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2026-09-02')
  })

  it('非法受控值不抛错（按未选择处理）', () => {
    render(<DateRangePicker startDate="bad-input" endDate="" onChange={() => {}} />)
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('')
  })

  it('清除按钮：onChange 回传空串（该端不限）', () => {
    const onChange = vi.fn()
    render(<DateRangePicker startDate="2026-09-01" endDate="" onChange={onChange} />)
    const clearBtn = document.querySelector('.ant-picker-clear')
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn as Element)
    expect(onChange).toHaveBeenCalledWith({ startDate: '', endDate: '' })
  })

  it('toDateDay/toDateStr：合法值解析回格式化值，空串与非法值归一为 null/空串', () => {
    expect(toDateStr(toDateDay('2026-08-15'))).toBe('2026-08-15')
    expect(toDateDay('')).toBeNull()
    expect(toDateDay('bad-input')).toBeNull()
    expect(toDateStr(null)).toBe('')
  })

  it('disableAfter：起始端禁用晚于结束端的日期（结束端未选时不限制）', () => {
    const d = (s: string) => dayjs(s)
    const rule = disableAfter('2026-09-02')
    expect(rule(d('2026-09-01'))).toBe(false)
    expect(rule(d('2026-09-02'))).toBe(false)
    expect(rule(d('2026-09-03'))).toBe(true)
    const noLimit = disableAfter('')
    expect(noLimit(d('2030-01-01'))).toBe(false)
  })

  it('disableBefore：结束端禁用早于起始端的日期（起始端未选时不限制）', () => {
    const d = (s: string) => dayjs(s)
    const rule = disableBefore('2026-09-02')
    expect(rule(d('2026-09-01'))).toBe(true)
    expect(rule(d('2026-09-02'))).toBe(false)
    expect(rule(d('2026-09-03'))).toBe(false)
    const noLimit = disableBefore('')
    expect(noLimit(d('2000-01-01'))).toBe(false)
  })
})
