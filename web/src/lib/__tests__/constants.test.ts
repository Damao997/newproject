import { describe, it, expect } from 'vitest'
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'

describe('达成率红绿灯阈值', () => {
  it('达标线 75 / 预警线 60（与 KPI 卡分级语义一致）', () => {
    expect(ACHIEVEMENT_RATE_THRESHOLDS.PASS).toBe(75)
    expect(ACHIEVEMENT_RATE_THRESHOLDS.WARN).toBe(60)
  })
})
