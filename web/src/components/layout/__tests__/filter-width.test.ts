import { describe, it, expect } from 'vitest'
import { FILTER_WIDTH } from '../filter-width'

describe('FILTER_WIDTH 宽度语义常量', () => {
  it('主体 180 / 期间 140 / 中宽 200', () => {
    expect(FILTER_WIDTH.subject).toBe('w-[180px]')
    expect(FILTER_WIDTH.period).toBe('w-[140px]')
    expect(FILTER_WIDTH.medium).toBe('w-[200px]')
  })
})
