import { KpiCard } from '@/components/charts/kpi-card'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Heatmap } from '@/components/ui/heatmap'
import { RingProgress } from '@/components/ui/ring-progress'
import { Steps } from '@/components/ui/steps'
import { StaleBar } from '@/components/ui/stale-bar'
import { Pill } from '@/components/ui/pill'
import { RankBadge } from '@/components/ui/rank-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/themeStore'
import type { KpiData } from '@/types'

const SAMPLE_KPIS: KpiData[] = [
  { title: '收入', monthActual: 1284.6, monthRate: 96.5, ytdActual: 9876.5, yoy: 0.123, ytdRate: 82.4, trend: [100, 110, 120, 130, 128, 135, 140] },
  { title: '毛利', monthActual: 462.3, monthRate: 68.0, ytdActual: 3450.0, yoy: -0.025, ytdRate: 65.0, trend: [80, 82, 78, 75, 73, 70, 72] },
  { title: '回款', monthActual: 980.1, monthRate: 45.0, ytdActual: 7200.0, yoy: 0.082, ytdRate: 58.0, trend: [60, 65, 70, 75, 78, 82, 90] },
  { title: '净利润', monthActual: 312.0, monthRate: null, ytdActual: 2100.0, yoy: 0, ytdRate: null, trend: [] },
]

const HEATMAP_DATA = [
  [{ level: 1 as const }, { level: 2 as const }, { level: 3 as const }, { level: 4 as const }, { level: 5 as const }, { level: 3 as const }, { level: 2 as const }, { level: 1 as const }, { level: 0 as const }, { level: 0 as const }, { level: 1 as const }, { level: 2 as const }],
  [{ level: 2 as const }, { level: 3 as const }, { level: 4 as const }, { level: 5 as const }, { level: 4 as const }, { level: 3 as const }, { level: 2 as const }, { level: 1 as const }, { level: 0 as const }, { level: 1 as const }, { level: 2 as const }, { level: 3 as const }],
  [{ level: 0 as const }, { level: 1 as const }, { level: 2 as const }, { level: 3 as const }, { level: 4 as const }, { level: 5 as const }, { level: 4 as const }, { level: 3 as const }, { level: 2 as const }, { level: 1 as const }, { level: 2 as const }, { level: 3 as const }],
  [{ level: 1 as const }, { level: 1 as const }, { level: 2 as const }, { level: 3 as const }, { level: 3 as const }, { level: 4 as const }, { level: 3 as const }, { level: 2 as const }, { level: 1 as const }, { level: 0 as const }, { level: 0 as const }, { level: 1 as const }],
  [{ level: 0 as const }, { level: 0 as const }, { level: 1 as const }, { level: 2 as const }, { level: 3 as const }, { level: 3 as const }, { level: 2 as const }, { level: 1 as const }, { level: 0 as const }, { level: 0 as const }, { level: 1 as const }, { level: 1 as const }],
]

const BRAND = [
  { n: 50, hex: '#e6f4ff', t: 'tint' }, { n: 100, hex: '#bae0ff', t: 'tint' }, { n: 200, hex: '#91caff', t: 'tint' }, { n: 300, hex: '#69b1ff', t: '' }, { n: 400, hex: '#4096ff', t: '' }, { n: 500, hex: '#1677ff', t: 'base' }, { n: 600, hex: '#0958d9', t: 'hover' }, { n: 700, hex: '#003eb3', t: '' }, { n: 800, hex: '#002c8c', t: '' }, { n: 900, hex: '#001d66', t: 'ink' },
] as const
const ORANGE = [
  { n: 50, hex: '#fff7e6', t: 'tint' }, { n: 100, hex: '#ffe7ba', t: '' }, { n: 200, hex: '#ffd591', t: '' }, { n: 300, hex: '#ffc069', t: '' }, { n: 400, hex: '#ffa940', t: '' }, { n: 500, hex: '#fa8c16', t: 'base' }, { n: 600, hex: '#d46b08', t: 'hover' }, { n: 700, hex: '#ad4e00', t: '' }, { n: 800, hex: '#873800', t: '' }, { n: 900, hex: '#612500', t: 'ink' },
] as const
const COOL = [
  { n: 1, hex: '#ffffff' }, { n: 2, hex: '#fafbfc' }, { n: 3, hex: '#f2f3f5' }, { n: 4, hex: '#e5e6eb' }, { n: 5, hex: '#c9cdd4' }, { n: 6, hex: '#a9aeb8' }, { n: 7, hex: '#86909c' }, { n: 8, hex: '#6b7785' }, { n: 9, hex: '#4e5969' }, { n: 10, hex: '#272e3b' }, { n: 11, hex: '#1d2129' }, { n: 12, hex: '#11161f' },
] as const
const WARM = [
  { n: 1, hex: '#fafafa' }, { n: 2, hex: '#f5f5f5' }, { n: 3, hex: '#f0f0f0' }, { n: 4, hex: '#d9d9d9' }, { n: 5, hex: '#bfbfbf' }, { n: 6, hex: '#8c8c8c' }, { n: 7, hex: '#595959' }, { n: 8, hex: '#434343' }, { n: 9, hex: '#262626' }, { n: 10, hex: '#1f1f1f' },
] as const
const STATE = [
  { name: 'Success', main: '#52c41a', bg: '#f6ffed', border: '#b7eb8f' },
  { name: 'Warning', main: '#faad14', bg: '#fffbe6', border: '#ffe58f' },
  { name: 'Error', main: '#ff4d4f', bg: '#fff2f0', border: '#ffccc7' },
  { name: 'Info', main: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
] as const
const TYPE = [
  { n: 'xs', px: 12, lh: 20, w: 500 }, { n: 'sm', px: 14, lh: 22, w: 400 }, { n: 'base', px: 16, lh: 24, w: 400 }, { n: 'lg', px: 18, lh: 28, w: 400 }, { n: 'xl', px: 20, lh: 28, w: 500 }, { n: '2xl', px: 24, lh: 32, w: 600 }, { n: '3xl', px: 30, lh: 40, w: 600 }, { n: '4xl', px: 34, lh: 44, w: 700 }, { n: '5xl', px: 38, lh: 48, w: 700 },
] as const
const SPACE = [4, 8, 12, 16, 20, 24, 32, 40, 48] as const
const RADIUS = [{ n: 'xs', px: 4 }, { n: 'sm', px: 6 }, { n: 'md', px: 8 }, { n: 'lg', px: 12 }, { n: 'xl', px: 16 }] as const
const SHADOW = [
  { n: 'sm', css: '0 1px 2px 0 rgba(0,0,0,0.06), 0 1px 6px -1px rgba(0,0,0,0.04)' },
  { n: 'md', css: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.06), 0 9px 28px 8px rgba(0,0,0,0.05)' },
  { n: 'lg', css: '0 12px 32px 0 rgba(0,0,0,0.10), 0 4px 8px -2px rgba(0,0,0,0.06)' },
] as const
const BP = [
  { n: 'xs', w: 320, label: '超小' }, { n: 'sm', w: 480, label: '小屏' }, { n: 'md', w: 768, label: '平板' }, { n: 'lg', w: 1024, label: '桌面' }, { n: 'xl', w: 1280, label: '宽屏' }, { n: '2xl', w: 1536, label: '巨屏' },
] as const
const ADAPT = [
  { area: '总账凭证', pri: 'P0', main: '全部屏支持' }, { area: '科目余额表', pri: 'P0', main: '全部屏支持' }, { area: '收入/毛利 KPI', pri: 'P0', main: '全部屏支持' }, { area: '趋势折线图', pri: 'P1', main: '≥sm 完整' }, { area: '热力网格', pri: 'P1', main: '≥md 完整' }, { area: 'Ring 环', pri: 'P1', main: '≥md 完整' }, { area: '右侧详情抽屉', pri: 'P2', main: '≥lg 展开' }, { area: '高级筛选', pri: 'P2', main: '≥md 弹出' }, { area: '多列表格', pri: 'P2', main: '≥md 横向滚动' }, { area: '批量操作', pri: 'P2', main: '≥lg 工具栏' }, { area: '数据钻取', pri: 'P3', main: '≥lg 弹出' }, { area: '三栏布局', pri: 'P3', main: '≥xl 启用' }, { area: '画布编辑', pri: 'P3', main: '≥xl 启用' }, { area: '全局搜索', pri: 'P2', main: '全部屏工具栏' },
] as const

const PRESETS = [
  { key: 'light', label: '浅色' },
  { key: 'gradient', label: '深紫' },
  { key: 'dark', label: '深色' },
  { key: 'antd', label: '深蓝' },
] as const

const SWATCH = (varName: string, label: string) => (
  <div className="flex flex-col items-center gap-1">
    <div className="h-10 w-full rounded border border-border" style={{ background: `hsl(var(${varName}))` }} />
    <div className="text-[10px] text-muted-foreground">{label}</div>
  </div>
)

function DocSection({ idx, title, sub, children }: { idx: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={`sec-${idx}`} className="space-y-4 scroll-mt-20">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <span className="font-mono text-xs text-muted-foreground">{idx}</span>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {desc && <div className="text-[11px] text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function SwatchFamily({ items }: { items: ReadonlyArray<{ n: number; hex: string; t?: string }> }) {
  return (
    <div className="grid grid-cols-10 gap-1.5">
      {items.map((it) => (
        <div key={it.n} className="flex flex-col">
          <div className="h-12 w-full rounded border border-border" style={{ background: it.hex }} />
          <div className="mt-1 font-mono text-[9px] text-muted-foreground">{it.n}</div>
          <div className="font-mono text-[9px] text-muted-foreground">{it.hex}</div>
        </div>
      ))}
    </div>
  )
}

function Demo({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        {desc && <div className="text-[10px] text-muted-foreground">{desc}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground">
      <code>{code}</code>
    </pre>
  )
}

function Usage({ when, avoid }: { when: string[]; avoid: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-[11px]">
      <div className="rounded border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">✓ 何时使用</div>
        {when.map((w, i) => <div key={i} className="text-emerald-700 dark:text-emerald-300">· {w}</div>)}
      </div>
      <div className="rounded border border-rose-200 bg-rose-50 p-2 dark:border-rose-800 dark:bg-rose-950/30">
        <div className="mb-1 font-semibold text-rose-700 dark:text-rose-300">✗ 避免</div>
        {avoid.map((a, i) => <div key={i} className="text-rose-700 dark:text-rose-300">· {a}</div>)}
      </div>
    </div>
  )
}

export default function DesignSnapshotPage() {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const setSidebarStyle = useThemeStore((s) => s.setSidebarStyle)

  return (
    <div className="space-y-8 p-4">
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-muted-foreground">FY200 · Design System v1</div>
            <h1 className="text-3xl font-bold text-foreground">antd-style 设计总览</h1>
            <p className="mt-1 text-sm text-muted-foreground">色彩 / 字体 / 间距 / 阴影 / 动效 / 组件 / 布局 / 响应式 — 8 大模块 1 站通览</p>
          </div>
          <div className="flex items-center gap-2">
            {PRESETS.map((p) => (
              <Button key={p.key} variant={sidebarStyle === p.key ? 'default' : 'outline'} size="sm" onClick={() => setSidebarStyle(p.key)}>{p.label}</Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-2 py-0.5">📐 Tokens</span>
          <span className="rounded bg-muted px-2 py-0.5">🎨 Palette</span>
          <span className="rounded bg-muted px-2 py-0.5">🧩 Components</span>
          <span className="rounded bg-muted px-2 py-0.5">🖥 Shell</span>
          <span className="rounded bg-muted px-2 py-0.5">📱 Responsive</span>
          <span className="rounded bg-muted px-2 py-0.5">🌗 Theme</span>
          <span className="rounded bg-muted px-2 py-0.5">🇨🇳 i18n zh-CN</span>
        </div>
      </header>

      <DocSection idx="01" title="Color Palette" sub="品牌 · 强调 · 中性 · 状态">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Group title="品牌蓝（Brand）" desc="主色 / 链接 / 选中态 / 数据正向">
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <div className="h-3 w-3 rounded" style={{ background: '#1677ff' }} />
              <span className="font-medium">#1677ff</span>
              <span className="text-muted-foreground">— 主品牌色 base-500</span>
            </div>
            <SwatchFamily items={BRAND} />
            <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
              <div className="rounded p-1.5" style={{ background: '#e6f4ff', color: '#001d66' }}>50 tint</div>
              <div className="rounded p-1.5" style={{ background: '#bae0ff', color: '#001d66' }}>100 tint</div>
              <div className="rounded p-1.5" style={{ background: '#1677ff', color: '#fff' }}>500 base</div>
              <div className="rounded p-1.5" style={{ background: '#001d66', color: '#fff' }}>900 ink</div>
            </div>
          </Group>
          <Group title="强调橙（Accent）" desc="业务高亮 / 提醒 / 趋势告警">
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <div className="h-3 w-3 rounded" style={{ background: '#fa8c16' }} />
              <span className="font-medium">#fa8c16</span>
              <span className="text-muted-foreground">— 强调色 base-500</span>
            </div>
            <SwatchFamily items={ORANGE} />
            <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
              <div className="rounded p-1.5" style={{ background: '#fff7e6', color: '#612500' }}>50 tint</div>
              <div className="rounded p-1.5" style={{ background: '#ffd591', color: '#612500' }}>200</div>
              <div className="rounded p-1.5" style={{ background: '#fa8c16', color: '#fff' }}>500 base</div>
              <div className="rounded p-1.5" style={{ background: '#612500', color: '#fff' }}>900 ink</div>
            </div>
          </Group>
          <Group title="冷灰 / 暖灰" desc="背景 / 描边 / 文本三阶">
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <div className="h-3 w-3 rounded" style={{ background: '#4e5969' }} />
              <span className="font-medium">#4e5969</span>
              <span className="text-muted-foreground">— cool-9 正文</span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {COOL.map((c) => (
                <div key={c.n} className="flex flex-col">
                  <div className="h-8 w-full rounded border border-border" style={{ background: c.hex }} />
                  <div className="mt-0.5 text-center font-mono text-[8px] text-muted-foreground">{c.n}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {WARM.map((c) => (
                <div key={c.n} className="flex flex-col">
                  <div className="h-7 w-full rounded border border-border" style={{ background: c.hex }} />
                  <div className="mt-0.5 text-center font-mono text-[8px] text-muted-foreground">{c.n}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground">暖灰用于侧栏 / 顶栏 / 弹层底色；冷灰用于文本 / 描边 / 阴影</div>
          </Group>
        </div>
        <Group title="派生色族" desc="基础色阶 + 背景 + 描边 = 完整色族">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[BRAND, ORANGE, COOL.map((c) => ({ n: c.n, hex: c.hex })), WARM.map((c) => ({ n: c.n, hex: c.hex }))].map((arr, i) => (
              <div key={i} className="rounded border border-border p-2">
                <div className="mb-1 text-[10px] font-medium">{['Brand', 'Orange', 'Cool', 'Warm'][i]}</div>
                <div className="grid grid-cols-5 gap-1">
                  {arr.slice(0, 5).map((it) => (
                    <div key={it.n} className="h-5 rounded" style={{ background: it.hex }} title={it.hex} />
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  <div className="h-3 rounded" style={{ background: i === 0 ? '#e6f4ff' : i === 1 ? '#fff7e6' : '#fafbfc' }} />
                  <div className="h-3 rounded" style={{ background: i === 0 ? '#91caff' : i === 1 ? '#ffd591' : '#e5e6eb' }} />
                  <div className="h-3 rounded" style={{ background: i === 0 ? '#1677ff' : i === 1 ? '#fa8c16' : '#4e5969' }} />
                </div>
                <div className="mt-1 font-mono text-[8px] text-muted-foreground">tint / soft / base</div>
              </div>
            ))}
          </div>
        </Group>
        <Group title="状态色 4 套" desc="main / bg / border">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {STATE.map((s) => (
              <div key={s.name} className="rounded border border-border p-2">
                <div className="mb-1 text-[11px] font-medium">{s.name}</div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="h-10 rounded" style={{ background: s.bg }} />
                  <div className="h-10 rounded" style={{ background: s.border }} />
                  <div className="h-10 rounded" style={{ background: s.main }} />
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-center font-mono text-[8px] text-muted-foreground">
                  <div>bg</div><div>bd</div><div>main</div>
                </div>
              </div>
            ))}
          </div>
        </Group>
        <Group title="使用边界（Do / Don't）">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1">场景</th>
                  <th className="px-2 py-1">推荐</th>
                  <th className="px-2 py-1">避免</th>
                  <th className="px-2 py-1">理由</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['主操作按钮', 'Brand-500', 'Gray / Orange', '蓝=可点击，橙=提醒'],
                  ['数据告警', 'Orange-500', 'Brand-500', '蓝不能用于告警'],
                  ['成功提示', 'Success main', 'Brand / Orange', '语义明确'],
                  ['危险操作', 'Error main', 'Orange / Brand', '必须红'],
                  ['主标题', 'Cool-12', 'Brand', '文本不应着色'],
                  ['次要文本', 'Cool-9 / 7', 'Cool-12', '对比度控制'],
                  ['侧栏底色', 'Warm-1 / 2', '纯白', '区分内容区'],
                  ['分隔线', 'Cool-4', 'Cool-1', '需要可见'],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-2 py-1 font-medium">{row[0]}</td>
                    <td className="px-2 py-1 text-foreground">{row[1]}</td>
                    <td className="px-2 py-1 text-rose-600">{row[2]}</td>
                    <td className="px-2 py-1 text-muted-foreground">{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Group>
      </DocSection>

      <DocSection idx="02" title="Design Tokens" sub="颜色 · 字体 · 间距 · 圆角 · 阴影 · 动效">
        <Group title="Color 基础色板（HSL 三元组）" desc="globals.css :root — 13 蓝 / 9 橙 / 10 中性 / 12 冷灰">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">blue (13)</div>
              <div className="grid grid-cols-13 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => SWATCH(`--blue-${n}`, String(n)))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">orange (10)</div>
              <div className="grid grid-cols-10 gap-1.5">
                {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => SWATCH(`--orange-${n}`, String(n)))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">ink (10)</div>
              <div className="grid grid-cols-10 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => SWATCH(`--ink-${n}`, String(n)))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">cool (12)</div>
              <div className="grid grid-cols-12 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => SWATCH(`--cool-${n}`, String(n)))}
              </div>
            </div>
          </div>
        </Group>
        <Group title="Typography 字体阶（9 档）" desc="font-family: Inter / system-ui">
          <div className="space-y-2">
            {TYPE.map((t) => (
              <div key={t.n} className="flex items-center gap-3 border-b border-border pb-1.5 last:border-0">
                <div className="w-12 font-mono text-[10px] text-muted-foreground">{t.n}</div>
                <div className="w-16 font-mono text-[10px] text-muted-foreground">{t.px}/{t.lh}</div>
                <div className="w-12 font-mono text-[10px] text-muted-foreground">w{t.w}</div>
                <div style={{ fontSize: t.px, lineHeight: `${t.lh}px`, fontWeight: t.w }} className="flex-1 text-foreground">
                  财务报表 FY2024 年度审计 收入 1,284.6 万
                </div>
              </div>
            ))}
          </div>
        </Group>
        <Group title="Spacing 间距（9 档）" desc="基于 4px 栅格">
          <div className="grid grid-cols-9 gap-2">
            {SPACE.map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <div className="h-12 w-12 rounded bg-[#1677ff]" style={{ width: s, height: s }} />
                <div className="font-mono text-[10px] text-muted-foreground">{s}px</div>
                <div className="text-[9px] text-muted-foreground">sp-{s}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div>4-8 内联间距 / 12 列表内 / 16 表单 / 20 卡内 / 24 卡间距</div>
            <div>32 模块 / 40 区块 / 48 页面边距</div>
          </div>
        </Group>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Group title="Radius 圆角（5 档）" desc="4 / 6 / 8 / 12 / 16">
            <div className="grid grid-cols-5 gap-2">
              {RADIUS.map((r) => (
                <div key={r.n} className="flex flex-col items-center gap-1">
                  <div className="h-14 w-14 bg-[#1677ff]" style={{ borderRadius: r.px }} />
                  <div className="text-[10px] font-medium">{r.n}</div>
                  <div className="font-mono text-[9px] text-muted-foreground">{r.px}px</div>
                </div>
              ))}
            </div>
          </Group>
          <Group title="Shadow 阴影（3 档）" desc="sm / md / lg">
            <div className="grid grid-cols-3 gap-3">
              {SHADOW.map((s) => (
                <div key={s.n} className="flex flex-col items-center gap-1">
                  <div className="h-16 w-16 rounded bg-white" style={{ boxShadow: s.css }} />
                  <div className="text-[10px] font-medium">{s.n}</div>
                </div>
              ))}
            </div>
          </Group>
        </div>
        <Group title="Motion 动效（3 关键帧）" desc="pulse · skel · fadeIn">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[#fa8c16]" style={{ animation: 'pulse 2s infinite' }} />
                <span className="text-[11px] font-medium">pulse</span>
              </div>
              <CodeBlock code="@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }" />
              <div className="mt-1 text-[10px] text-muted-foreground">告警点 / 在线状态</div>
            </div>
            <div className="rounded border border-border p-3">
              <div className="mb-2 h-2 rounded bg-gradient-to-r from-[#f0f0f0] via-[#bfbfbf] to-[#f0f0f0] bg-[length:200%_100%]" style={{ animation: 'skel 1.4s infinite' }} />
              <div className="text-[11px] font-medium">skel</div>
              <CodeBlock code="@keyframes skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }" />
              <div className="mt-1 text-[10px] text-muted-foreground">骨架屏</div>
            </div>
            <div className="rounded border border-border p-3">
              <div className="mb-2 h-6 rounded bg-[#1677ff]/20" style={{ animation: 'fadeIn .3s' }} />
              <div className="text-[11px] font-medium">fadeIn</div>
              <CodeBlock code="@keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1} }" />
              <div className="mt-1 text-[10px] text-muted-foreground">入场</div>
            </div>
          </div>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1}}`}</style>
        </Group>
      </DocSection>

      <DocSection idx="03" title="Component Library" sub="Foundations · KPI · Visualize · Status · Emphasis · Skeleton · Don't">
        <Group title="01 Foundations · 基础控件" desc="Button / Input / Tag / Checkbox / Radio / Switch">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Demo title="Button" desc="4 variants × 3 sizes">
              <Button variant="default" size="sm">主要 sm</Button>
              <Button variant="default">主要</Button>
              <Button variant="default" size="lg">主要 lg</Button>
              <Button variant="outline" size="sm">次要 sm</Button>
              <Button variant="outline">次要</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="destructive">危险</Button>
              <Button variant="link">链接</Button>
              <Button disabled>禁用</Button>
            </Demo>
            <Demo title="Input" desc="default / focus / error / disabled">
              <input className="h-8 rounded border border-input bg-background px-2 text-xs" placeholder="默认" />
              <input className="h-8 rounded border-2 border-[#1677ff] bg-background px-2 text-xs ring-2 ring-[#1677ff]/20" defaultValue="已填" />
              <input className="h-8 rounded border-2 border-[#ff4d4f] bg-background px-2 text-xs ring-2 ring-[#ff4d4f]/20" defaultValue="错误" />
              <input className="h-8 rounded border border-input bg-muted px-2 text-xs" placeholder="禁用" disabled />
              <textarea className="h-16 rounded border border-input bg-background px-2 py-1 text-xs" placeholder="Textarea 3 行" />
            </Demo>
            <Demo title="Tag / Pill / Badge" desc="5 色 + 状态点">
              <Pill tone="blue">主信息</Pill>
              <Pill tone="orange">业务高亮</Pill>
              <Pill tone="green">已达成</Pill>
              <Pill tone="red">失败</Pill>
              <Pill tone="gray">中性</Pill>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 rounded-full bg-[#52c41a]" />在线</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 rounded-full bg-[#faad14]" />告警</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 rounded-full bg-[#ff4d4f]" />离线</span>
            </Demo>
            <Demo title="Checkbox / Radio / Switch" desc="3 选 1 / 多选 / 开关">
              <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" defaultChecked />收入</label>
              <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" />成本</label>
              <label className="flex items-center gap-1.5 text-[11px]"><input type="radio" name="r" defaultChecked />本月</label>
              <label className="flex items-center gap-1.5 text-[11px]"><input type="radio" name="r" />本年</label>
              <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" className="sr-only peer" /><div className="h-4 w-7 rounded-full bg-[#1677ff] relative after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:content-[''] peer-checked:after:translate-x-3" /></label>
            </Demo>
            <Demo title="Select / Dropdown" desc="下拉 / 多选 / 级联">
              <select className="h-8 rounded border border-input bg-background px-2 text-xs"><option>2024 年</option><option>2023 年</option></select>
              <select className="h-8 rounded border border-input bg-background px-2 text-xs"><option>全部主体</option><option>母公司</option><option>子公司</option></select>
              <div className="relative"><button className="h-8 rounded border border-input bg-background px-2 text-xs">操作 ▾</button></div>
            </Demo>
            <Demo title="Progress / Skeleton" desc="进度 / 骨架">
              <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-[#1677ff]" style={{ width: '72%' }} /></div>
              <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-[#fa8c16]" style={{ width: '45%' }} /></div>
              <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-[#52c41a]" style={{ width: '92%' }} /></div>
              <div className="h-3 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </Demo>
          </div>
        </Group>
        <Group title="02 KPI Tiles · 4 stat-tile 变体" desc="primary / trend / goal / plain">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {SAMPLE_KPIS.map((kpi, i) => (
              <div key={kpi.title} className="rounded border border-border bg-card p-3">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{kpi.title}</span><span className="font-mono">#{i + 1}</span>
                </div>
                <div className="text-2xl font-bold text-foreground">{kpi.monthActual}<span className="ml-1 text-xs font-normal text-muted-foreground">万</span></div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-[#52c41a]">↑ YoY {(kpi.yoy! * 100).toFixed(1)}%</span>
                  <span className="text-muted-foreground">月达成 {kpi.monthRate ?? '—'}%</span>
                </div>
                <div className="mt-2 h-6 flex items-end gap-0.5">
                  {kpi.trend.map((v, j) => (
                    <div key={j} className="flex-1 rounded-t bg-[#1677ff]/60" style={{ height: `${(v / 150) * 100}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Group>
        <Group title="03 Visualization · 4 类图表组件" desc="mini-bar / rank-badge / ring-progress / heatmap">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">MiniBar 7 日</CardTitle><CardDescription>sparkline-style 柱图</CardDescription></CardHeader>
              <CardContent>
                <div className="h-12 flex items-end gap-1">
                  {[40, 65, 30, 80, 55, 90, 70].map((v, i) => (
                    <div key={i} className="flex-1 rounded-t bg-[#1677ff]" style={{ height: `${v}%` }} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-muted-foreground"><span>周一</span><span>周日</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">RankBadge</CardTitle><CardDescription>1=橙 / 2=黄 / 3=绿 / 4+=灰</CardDescription></CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((r) => <RankBadge key={r} rank={r} />)}
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">用于 Top-N 排名、热门榜</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">RingProgress</CardTitle><CardDescription>conic-gradient 环</CardDescription></CardHeader>
              <CardContent>
                <div className="flex items-center justify-around">
                  <RingProgress value={75} tone="blue" label="75%" size={64} thickness={7} />
                  <RingProgress value={50} tone="orange" label="50%" size={64} thickness={7} />
                  <RingProgress value={92} tone="green" label="92%" size={64} thickness={7} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Heatmap</CardTitle><CardDescription>5×12 业务线 × 月份</CardDescription></CardHeader>
              <CardContent>
                <Heatmap
                  data={HEATMAP_DATA}
                  rowLabels={['销售', '服务', '租赁', '咨询', '其他']}
                  colLabels={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']}
                />
              </CardContent>
            </Card>
          </div>
        </Group>
        <Group title="04 Status · 状态可视化" desc="5 档 · StaleBar · Stepper">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-[11px] font-medium">StaleBar 告警条</div>
              <div className="space-y-2">
                <StaleBar meta="2 小时前更新">本月数据存在 3 项异常</StaleBar>
                <StaleBar>部分科目余额未同步</StaleBar>
                <StaleBar meta="刚刚">对账完成，全部一致</StaleBar>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-medium">Steps 步骤条</div>
              <Steps
                current={2}
                items={[
                  { title: '导入数据', description: '上传 Excel / CSV' },
                  { title: '配置映射', description: '字段对应关系' },
                  { title: '校验预览', description: '前 100 行校验' },
                  { title: '完成入库', description: '写入主数据库' },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-[11px] font-medium">KpiCard 完整版</div>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_KPIS.slice(0, 2).map((k, i) => <KpiCard key={k.title} data={k} index={i} />)}
              </div>
            </div>
          </div>
        </Group>
        <Group title="05 Emphasis · 强调层级" desc="primary / strong / subtle / none">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded border-l-4 border-[#1677ff] bg-[#e6f4ff]/40 p-3">
              <div className="text-[10px] font-medium text-[#003eb3]">PRIMARY · 主要强调</div>
              <div className="mt-0.5 text-sm text-foreground">重要操作或关键状态。蓝底蓝边，主行动点。</div>
            </div>
            <div className="rounded border-l-4 border-[#fa8c16] bg-[#fff7e6]/60 p-3">
              <div className="text-[10px] font-medium text-[#873800]">STRONG · 次强调</div>
              <div className="mt-0.5 text-sm text-foreground">业务高亮 / 趋势告警。橙底橙边，提醒类。</div>
            </div>
            <div className="rounded border-l-4 border-border bg-muted/40 p-3">
              <div className="text-[10px] font-medium text-muted-foreground">SUBTLE · 弱化</div>
              <div className="mt-0.5 text-sm text-foreground">辅助说明、提示文本。灰边灰底。</div>
            </div>
            <div className="rounded border border-dashed border-border p-3">
              <div className="text-[10px] font-medium text-muted-foreground">NONE · 无强调</div>
              <div className="mt-0.5 text-sm text-foreground">默认 / 普通文本。虚线边，弱视觉权重。</div>
            </div>
          </div>
        </Group>
        <Group title="06 Skeleton · 骨架屏" desc="3 类 · card / list / table">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded border border-border p-3">
              <div className="text-[10px] font-medium">Card</div>
              <div className="mt-2 h-24 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
              <div className="mt-2 h-3 w-3/4 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
              <div className="mt-1 h-3 w-1/2 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
            </div>
            <div className="rounded border border-border p-3">
              <div className="text-[10px] font-medium">List</div>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="mt-2 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
                  <div className="flex-1 space-y-1">
                    <div className="h-2.5 w-full rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
                    <div className="h-2.5 w-2/3 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded border border-border p-3">
              <div className="text-[10px] font-medium">Table</div>
              <table className="mt-2 w-full text-[10px]">
                <tbody>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-1.5"><div className="h-2.5 w-3/4 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} /></td>
                      <td className="py-1.5"><div className="h-2.5 w-1/2 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} /></td>
                      <td className="py-1.5"><div className="h-2.5 w-2/3 rounded bg-muted" style={{ animation: 'skel 1.4s infinite' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Group>
        <Group title="07 Don't · 红线清单" desc="反模式 / 不要这样用">
          <Usage
            when={[
              '主操作仅 1 个，使用 brand-500 实心按钮',
              '告警用 orange-500，配 pulse 关键帧',
              '状态 4 色保持语义统一（绿/黄/红/蓝）',
              '文本用 cool-9/7/5 阶梯，正文 ≥ 12px',
              '圆角统一 4/6/8/12/16 五档',
            ]}
            avoid={[
              '同一屏 > 3 个橙色高亮（橙色 = 告警）',
              '主色蓝用于报错 / 危险操作',
              'Tailwind 任意值如 w-[13px] 破坏栅格',
              '使用 emerald-400 / sky-300 等品牌外色',
              'body 用 10-11px（可读性差）',
            ]}
          />
        </Group>
      </DocSection>

      <DocSection idx="04" title="Shell System" sub="应用骨架 · 侧栏 · 顶栏 · 内容区">
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="grid grid-cols-[240px_1fr]">
            <aside className="bg-[#001529] text-white" style={{ background: 'linear-gradient(180deg, #001529 0%, #0A1E36 100%)' }}>
              <div className="flex h-16 items-center gap-2 border-b border-white/10 px-4">
                <div className="h-8 w-8 rounded bg-[#1677ff] flex items-center justify-center font-bold">F</div>
                <div>
                  <div className="text-sm font-semibold">FY200 财务</div>
                  <div className="text-[10px] text-white/60">v1.0.0</div>
                </div>
              </div>
              <nav className="px-2 py-3 text-[12px]">
                {[
                  { g: '总览', items: ['首页', '工作台', '待办'] },
                  { g: '财务', items: ['总账', '凭证', '科目余额', '报表中心'] },
                  { g: '业务', items: ['收入', '成本', '回款', '毛利分析'] },
                  { g: '分析', items: ['趋势', '热力', '对比', '钻取'] },
                  { g: '系统', items: ['权限', '组织', '日志'] },
                ].map((s) => (
                  <div key={s.g} className="mb-2">
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/40">{s.g}</div>
                    {s.items.map((it, i) => (
                      <div key={it} className={cn('flex items-center gap-2 rounded px-2 py-1.5', i === 0 && s.g === '总览' ? 'bg-[#1677ff]/30 text-white' : 'text-white/70 hover:bg-white/5')}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        {it}
                      </div>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="absolute bottom-0 w-[240px] border-t border-white/10 px-4 py-2 text-[10px] text-white/50">© 2024 FY200 Design · v1.0.0</div>
            </aside>
            <div>
              <header className="flex h-16 items-center gap-3 border-b border-border bg-white px-4">
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <span>首页</span><span>/</span><span>设计总览</span>
                </div>
                <div className="ml-4 flex-1 max-w-md">
                  <div className="flex h-8 items-center gap-2 rounded bg-muted px-3 text-[12px] text-muted-foreground">
                    <span>🔍</span> 搜索 / 报表 / 凭证号...
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#fff7e6] px-2 py-0.5 text-[10px] text-[#ad4e00]">财务期 2024-08</span>
                  <button className="h-8 w-8 rounded-full hover:bg-muted">🔔</button>
                  <button className="h-8 w-8 rounded-full hover:bg-muted">❓</button>
                  <div className="flex h-8 items-center gap-2 rounded-full bg-muted px-2">
                    <div className="h-6 w-6 rounded-full bg-[#1677ff] text-center text-white text-[10px] leading-6">Z</div>
                    <span className="text-[11px]">张总</span>
                  </div>
                </div>
              </header>
              <div className="p-4">
                <div className="grid grid-cols-4 gap-3">
                  {['收入 1,284 万', '毛利 462 万', '回款 980 万', '净利 312 万'].map((s, i) => (
                    <div key={i} className="rounded border border-border bg-white p-3">
                      <div className="text-[10px] text-muted-foreground">KPI #{i + 1}</div>
                      <div className="mt-1 text-base font-semibold">{s}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded border border-border bg-white p-4 text-[12px] text-muted-foreground">
                  内容区（占位）· 高度自适应，main 区域 p-4 / gap-3
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Group title="侧栏规格"><div className="space-y-1 text-[11px]"><div>宽 240 / 暗色 #001529 → #0A1E36</div><div>品牌区 h-16，nav 分 5 组</div><div>底栏版本 + 主题切换</div></div></Group>
          <Group title="顶栏规格"><div className="space-y-1 text-[11px]"><div>高 64 / 白底 / 下边 1px cool-4</div><div>面包屑 / 搜索 384 / 财务期 / 通知 / 帮助 / 头像</div><div>sticky 跟随滚动</div></div></Group>
          <Group title="内容区规格"><div className="space-y-1 text-[11px]"><div>padding 16 / 24；卡片间距 16</div><div>主区 min-h-0；滚动仅内容区</div><div>面包屑二级 / 标题 h2 / 工具栏右对齐</div></div></Group>
        </div>
      </DocSection>

      <DocSection idx="05" title="Responsive & Mobile" sub="5 断点 · 3 设备框 · 14 适配清单">
        <Group title="Breakpoints · 5 档断点" desc="xs / sm / md / lg / xl / 2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1">Token</th>
                  <th className="px-2 py-1">宽度</th>
                  <th className="px-2 py-1">设备</th>
                  <th className="px-2 py-1">标签</th>
                  <th className="px-2 py-1">主列数</th>
                  <th className="px-2 py-1">侧栏</th>
                </tr>
              </thead>
              <tbody>
                {BP.map((b) => (
                  <tr key={b.n} className="border-b border-border last:border-0">
                    <td className="px-2 py-1 font-mono font-medium text-foreground">{b.n}</td>
                    <td className="px-2 py-1 font-mono">≥ {b.w}px</td>
                    <td className="px-2 py-1 text-muted-foreground">{b.w < 480 ? 'iPhone SE' : b.w < 768 ? 'iPhone Pro' : b.w < 1024 ? 'iPad' : b.w < 1280 ? 'Laptop' : b.w < 1536 ? 'Desktop' : 'Wide'}</td>
                    <td className="px-2 py-1">{b.label}</td>
                    <td className="px-2 py-1 font-mono">{b.w < 480 ? 1 : b.w < 768 ? 2 : b.w < 1024 ? 4 : b.w < 1280 ? 6 : 8}</td>
                    <td className="px-2 py-1 text-muted-foreground">{b.w < 1024 ? '抽屉' : b.w < 1280 ? '折叠' : '固定'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Group>
        <Group title="bp-bar · 5 段连续区间" desc="mobile-portrait / mobile-landscape / tablet / desktop / wide">
          <div className="flex h-8 w-full overflow-hidden rounded border border-border text-[10px] text-white">
            <div className="flex items-center justify-center bg-[#1677ff]" style={{ flex: '0 0 20%' }}>mobile-portrait ≤480</div>
            <div className="flex items-center justify-center bg-[#4096ff]" style={{ flex: '0 0 20%' }}>mobile-landscape ≤768</div>
            <div className="flex items-center justify-center bg-[#69b1ff] text-[#001d66]" style={{ flex: '0 0 20%' }}>tablet ≤1024</div>
            <div className="flex items-center justify-center bg-[#91caff] text-[#001d66]" style={{ flex: '0 0 20%' }}>desktop ≤1280</div>
            <div className="flex items-center justify-center bg-[#bae0ff] text-[#001d66]" style={{ flex: 1 }}>wide &gt;1280</div>
          </div>
          <div className="mt-2 flex w-full text-[9px] text-muted-foreground">
            <div style={{ flex: '0 0 20%' }} className="text-center">320</div>
            <div style={{ flex: '0 0 20%' }} className="text-center">480</div>
            <div style={{ flex: '0 0 20%' }} className="text-center">768</div>
            <div style={{ flex: '0 0 20%' }} className="text-center">1024</div>
            <div style={{ flex: 1 }} className="text-center">1280+</div>
          </div>
        </Group>
        <Group title="Device Frames · 3 设备模拟" desc="iPhone SE 390 / iPad 768 / Desktop 1440">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">iPhone SE · 390 × 844</div>
              <div className="mx-auto w-[200px] rounded-[28px] border-[6px] border-[#11161f] bg-[#fafafa] p-1 shadow-md">
                <div className="rounded-[20px] bg-white">
                  <div className="flex h-6 items-center justify-center text-[9px] text-muted-foreground">9:41</div>
                  <div className="px-2 pb-2">
                    <div className="text-[11px] font-bold">财务速览</div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {['收入 1,284', '毛利 462'].map((s, i) => (
                        <div key={i} className="rounded bg-[#e6f4ff] p-1.5 text-[9px]">{s}</div>
                      ))}
                    </div>
                    <div className="mt-1 h-12 rounded bg-[#f0f0f0]" />
                    <div className="mt-1 space-y-0.5">
                      {[1, 2, 3, 4].map((i) => <div key={i} className="h-2 rounded bg-[#f0f0f0]" style={{ width: `${60 + i * 10}%` }} />)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">iPad · 768 × 1024</div>
              <div className="mx-auto w-[280px] rounded-[20px] border-[5px] border-[#11161f] bg-[#fafafa] p-1 shadow-md">
                <div className="rounded-[14px] bg-white p-2">
                  <div className="text-[11px] font-bold">财务速览</div>
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {['收入 1,284', '毛利 462', '回款 980', '净利 312'].map((s, i) => (
                      <div key={i} className="rounded bg-[#e6f4ff] p-1 text-[8px]">{s}</div>
                    ))}
                  </div>
                  <div className="mt-1 h-16 rounded bg-[#f0f0f0]" />
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <div className="h-12 rounded bg-[#fff7e6]" />
                    <div className="h-12 rounded bg-[#f6ffed]" />
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">Desktop · 1440 × 900</div>
              <div className="overflow-hidden rounded border-[3px] border-[#11161f] bg-[#fafafa] shadow-md">
                <div className="flex">
                  <div className="w-8 bg-[#001529] p-1 text-[7px] text-white/70">侧栏</div>
                  <div className="flex-1 bg-white p-1.5">
                    <div className="text-[10px] font-bold">财务速览</div>
                    <div className="mt-1 grid grid-cols-4 gap-1">
                      {['收入', '毛利', '回款', '净利'].map((s, i) => (
                        <div key={i} className="rounded bg-[#e6f4ff] p-1 text-[8px]">{s} 1,2xx</div>
                      ))}
                    </div>
                    <div className="mt-1 h-8 rounded bg-[#f0f0f0]" />
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      <div className="col-span-2 h-10 rounded bg-[#f0f0f0]" />
                      <div className="h-10 rounded bg-[#f0f0f0]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Group>
        <Group title="Adaptation List · 14 项" desc="P0 必做 / P1 应做 / P2 可做 / P3 后续">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1 w-10">#</th>
                  <th className="px-2 py-1">模块 / 区域</th>
                  <th className="px-2 py-1 w-16">优先级</th>
                  <th className="px-2 py-1">断点策略</th>
                  <th className="px-2 py-1 w-32">方案</th>
                </tr>
              </thead>
              <tbody>
                {ADAPT.map((a, i) => (
                  <tr key={a.area} className="border-b border-border last:border-0">
                    <td className="px-2 py-1 font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</td>
                    <td className="px-2 py-1 font-medium">{a.area}</td>
                    <td className="px-2 py-1">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px]',
                        a.pri === 'P0' && 'bg-[#fff2f0] text-[#ff4d4f]',
                        a.pri === 'P1' && 'bg-[#fff7e6] text-[#ad4e00]',
                        a.pri === 'P2' && 'bg-[#e6f4ff] text-[#003eb3]',
                        a.pri === 'P3' && 'bg-muted text-muted-foreground',
                      )}>{a.pri}</span>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{a.main}</td>
                    <td className="px-2 py-1 text-[10px] text-muted-foreground">
                      {a.pri === 'P0' ? '响应式' : a.pri === 'P1' ? '≥sm 完整' : a.pri === 'P2' ? '≥md 增强' : '≥xl 启用'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#ff4d4f]" />P0 必做 (3)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#fa8c16]" />P1 应做 (3)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#1677ff]" />P2 可做 (5)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />P3 后续 (3)</span>
          </div>
        </Group>
        <Group title="Mobile 速览" desc="≤480 px 下的简化布局">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded border border-border p-3">
              <div className="mb-2 text-[10px] font-medium">移动端 KPI 卡片</div>
              <div className="grid grid-cols-2 gap-1.5">
                {SAMPLE_KPIS.slice(0, 4).map((k) => (
                  <div key={k.title} className="rounded border-l-2 border-[#1677ff] bg-card p-2">
                    <div className="text-[9px] text-muted-foreground">{k.title}</div>
                    <div className="text-sm font-bold">{k.monthActual}</div>
                    <div className="text-[9px] text-[#52c41a]">↑ {(k.yoy! * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-border p-3">
              <div className="mb-2 text-[10px] font-medium">移动端列表</div>
              <div className="space-y-1">
                {['收入 1,284 万 ↑12.3%', '毛利 462 万 ↓2.5%', '回款 980 万 ↑8.2%', '净利 312 万 —'].map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded border border-border bg-card px-2 py-1.5 text-[10px]">
                    <span>{r}</span>
                    <span className="text-[9px] text-muted-foreground">详情 ›</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Group>
      </DocSection>

      <footer className="border-t border-border pt-3 text-[10px] text-muted-foreground">
        <div>FY200 Design System v1.0 · antd v5 tokens ↔ Tailwind v3 · Generated {new Date().toISOString().slice(0, 10)}</div>
        <div className="mt-1">Sections: 01 Color Palette · 02 Design Tokens · 03 Component Library · 04 Shell System · 05 Responsive & Mobile</div>
      </footer>
    </div>
  )
}
