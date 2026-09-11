/**
 * ECharts 精简核心：按需注册，替代整包 `import ReactECharts from 'echarts-for-react'`。
 *
 * 背景：整包引入使 vendor-charts chunk 达 ~1.15MB（gzip 386KB），远超
 * 《前端设计方案》§7.3「首屏 gzip < 150KB」的目标。本模块仅注册项目
 * 实际用到的图表与组件，其余（地图/关系图/3D 等）不进产物。
 *
 * 注册清单来源（新增图表类型时必须同步补注册，否则运行时图表空白）：
 *   - BarChart   : components/charts/trend-chart.tsx（收入/成本柱）、
 *                  pages/inventory/category-rank-card.tsx、trend-card.tsx
 *   - LineChart  : trend-chart.tsx（毛利/预算线）、kpi-sparkline.tsx、
 *                  pages/transactions/trend-card.tsx、pages/inventory/trend-card.tsx
 *   - PieChart   : pages/inventory/category-pie-card.tsx（品类占比饼图）
 *   - Grid       : 全部图表
 *   - Tooltip    : trend-chart、trend-card、inventory 各卡
 *   - Legend     : trend-chart、trend-card
 *   - DataZoom   : trend-card（inside + slider）
 *   - SVGRenderer: 全部图表均传 opts={{ renderer: 'svg' }}
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  SVGRenderer,
])

export { echarts }
export default ReactEChartsCore
