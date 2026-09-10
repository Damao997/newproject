import type { jsPDF } from 'jspdf'
import type { Paragraph as DocxParagraph, Table as DocxTable, ImageRun as DocxImageRun } from 'docx'
import type { ReportExportData } from '@/lib/api'
import notoSansScUrl from '@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf?url'

/**
 * 汇总分析报告导出：依据后端返回的结构化章节数据，前端生成 Word(docx) / PDF。
 * 正文解析章节富文本 HTML（后端已净化）映射为标题/列表/引用/表格/图片等结构，
 * 保留加粗/斜体/下划线/高亮等行内格式（原 plainText 平文本方案已升级为格式保真）。
 *
 * docx（~400KB）/ jspdf / file-saver 均在函数内动态 import —— 导出为低频操作，
 * 不应计入报告页首屏体积。类型以 `import type` 引入（编译期擦除，无运行时开销）。
 * PDF 为文本方案：保留标题层级/列表缩进/表格文本，图片不嵌入（Word 导出含图）。
 */

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '分析报告'
}

// ============ 富文本 HTML → 结构化块（docx / PDF 共用解析层） ============

interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  highlight?: boolean
  /** 该 run 前的换行数（<br> 转换） */
  breakBefore?: number
}

/** 内嵌图表块参数（TipTap chart Node 的 data-chart-* 序列化） */
interface ChartBlockAttrs {
  companyCode: string
  subjectCode: string
  subjectType: 'operating' | 'static' | 'cashflow'
  period: string
  title: string
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: InlineRun[][] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][]; headerRow: boolean }
  | { kind: 'image'; src: string }
  | { kind: 'chart'; attrs: ChartBlockAttrs }

/** 提取行内内容为 runs（strong/em/u/s/code/mark/a 展开；br 记为换行） */
function extractInlineRuns(node: Node, marks: Partial<InlineRun> = {}, out: InlineRun[] = []): InlineRun[] {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? ''
      if (text) out.push({ text, ...marks })
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      // 折叠为“下一 run 前换行”；若已是行尾则补空 run 承载
      const last = out[out.length - 1]
      if (last) last.breakBefore = (last.breakBefore ?? 0) + 1
      else out.push({ text: '', breakBefore: 1 })
      return
    }
    const next: Partial<InlineRun> = { ...marks }
    if (tag === 'strong' || tag === 'b') next.bold = true
    else if (tag === 'em' || tag === 'i') next.italic = true
    else if (tag === 'u') next.underline = true
    else if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
    else if (tag === 'code') next.code = true
    else if (tag === 'mark') next.highlight = true
    else if (tag === 'a') next.underline = true // 链接保真降级：保留下划线样式（Word 内不重建超链接）
    extractInlineRuns(el, next, out)
  })
  return out
}

/** 解析章节 HTML 为块序列（表格/列表/引用/图片/标题；未知容器递归展开） */
function parseSectionHtml(html: string): Block[] {
  const blocks: Block[] = []
  if (!html || !html.trim()) return blocks
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const pushImagesIn = (el: Element) => {
    el.querySelectorAll('img[src]').forEach((img) => {
      blocks.push({ kind: 'image', src: img.getAttribute('src') ?? '' })
    })
  }

  const walk = (parent: Element) => {
    Array.from(parent.children).forEach((el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'div' && el.hasAttribute('data-chart')) {
        // 内嵌图表节点：解析 data-chart-* 参数（取数渲染见 toDocxChartImageRun）
        const st = el.getAttribute('data-chart-subject-type')
        blocks.push({
          kind: 'chart',
          attrs: {
            companyCode: el.getAttribute('data-chart-company') ?? '',
            subjectCode: el.getAttribute('data-chart-subject') ?? '',
            subjectType: st === 'static' || st === 'cashflow' ? st : 'operating',
            period: el.getAttribute('data-chart-period') ?? '',
            title: el.getAttribute('data-chart-title') ?? '',
          },
        })
        return
      }
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        const level: 1 | 2 | 3 = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3
        blocks.push({ kind: 'heading', level, runs: extractInlineRuns(el) })
      } else if (tag === 'p') {
        if (el.querySelector('img[src]')) {
          // 块级图片偶发包裹于 p：拆分为图片块 + 文本段落
          pushImagesIn(el)
          const textRuns = extractInlineRuns(el)
          if (textRuns.length > 0) blocks.push({ kind: 'paragraph', runs: textRuns })
        } else {
          blocks.push({ kind: 'paragraph', runs: extractInlineRuns(el) })
        }
      } else if (tag === 'ul' || tag === 'ol') {
        const items: InlineRun[][] = []
        // 嵌套列表平铺为一维条目（导出场景保内容不保层级）
        const collectItems = (list: Element) => {
          Array.from(list.children).forEach((li) => {
            if (li.tagName.toLowerCase() !== 'li') return
            Array.from(li.children).forEach((c) => {
              const ct = c.tagName.toLowerCase()
              if (ct === 'ul' || ct === 'ol') collectItems(c)
            })
            const runs = extractInlineRuns(li)
            if (runs.length > 0) items.push(runs)
          })
        }
        collectItems(el)
        blocks.push({ kind: 'list', ordered: tag === 'ol', items })
      } else if (tag === 'blockquote') {
        const runs = extractInlineRuns(el)
        if (runs.length > 0) blocks.push({ kind: 'quote', runs })
      } else if (tag === 'pre') {
        blocks.push({ kind: 'code', text: el.textContent ?? '' })
      } else if (tag === 'table') {
        const rows: string[][] = []
        let headerRow = false
        Array.from(el.querySelectorAll('tr')).forEach((tr) => {
          const cells = Array.from(tr.children).map((td) => (td.textContent ?? '').trim())
          if (cells.length > 0) rows.push(cells)
          if (tr.querySelector('th')) headerRow = true
        })
        if (rows.length > 0) blocks.push({ kind: 'table', rows, headerRow })
      } else if (tag === 'img') {
        const src = el.getAttribute('src')
        if (src) blocks.push({ kind: 'image', src })
      } else if (el.children.length > 0) {
        walk(el) // div / tableWrapper 等容器递归
      } else {
        const runs = extractInlineRuns(el)
        if (runs.length > 0) blocks.push({ kind: 'paragraph', runs })
      }
    })
  }

  walk(doc.body)
  return blocks
}

const runsToPlainText = (runs: InlineRun[]): string => runs.map((r) => r.text).join('')

// ============ 图片加载与 canvas 统一转 PNG（docx ImageRun 仅支持 png/jpg/gif/bmp，webp 需转换） ============

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

async function toDocxImageRun(src: string): Promise<DocxImageRun | null> {
  try {
    const img = await loadImage(src)
    const maxW = 600
    const naturalW = img.naturalWidth || 400
    const naturalH = img.naturalHeight || 300
    const scale = Math.min(1, maxW / naturalW)
    const w = Math.max(1, Math.round(naturalW * scale))
    const h = Math.max(1, Math.round(naturalH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/png')
    const { ImageRun } = await import('docx')
    return new ImageRun({ type: 'png', data: dataUrl.split(',')[1] ?? '', transformation: { width: w, height: h } })
  } catch {
    return null // 外链失效/加载失败：导出降级跳过，不阻断整体导出
  }
}

/**
 * 内嵌图表 → docx ImageRun：取数（POST /reports/chart-data）+ 离屏 ECharts 渲染转 PNG。
 * echarts-core 与 api 均动态 import——避免 report-export 静态依赖 echarts（报告页首屏不含图表时不拉图表库）。
 */
async function toDocxChartImageRun(attrs: ChartBlockAttrs): Promise<DocxImageRun | null> {
  const W = 600
  const H = 320
  let container: HTMLDivElement | null = null
  try {
    const [{ echarts }, { api }, { ImageRun }] = await Promise.all([
      import('@/components/charts/echarts-core'),
      import('@/lib/api'),
      import('docx'),
    ])
    const data = await api.getReportChartData({
      companyCode: attrs.companyCode,
      subjectCode: attrs.subjectCode,
      subjectType: attrs.subjectType,
      period: attrs.period,
    })
    const isStatic = attrs.subjectType === 'static'
    const labels = isStatic ? ['期末值', '年初值', '上年同期'] : ['本期实际', '上年同期', '本期预算']
    const values = isStatic
      ? [data.current ?? null, data.yearStart ?? null, data.samePeriod ?? null]
      : [data.actual ?? null, data.samePeriod ?? null, data.budget ?? null]
    const seriesColors = ['#FF830F', '#36A2C3', '#8B7BD8']
    container = document.createElement('div')
    container.style.cssText = `position:absolute;left:-9999px;top:0;width:${W}px;height:${H}px`
    document.body.appendChild(container)
    const chart = echarts.init(container, null, { renderer: 'canvas', width: W, height: H })
    chart.setOption({
      animation: false,
      title: { text: attrs.title || data.name || attrs.subjectCode, left: 'center', textStyle: { fontSize: 14, color: '#1F2937' } },
      grid: { top: 48, right: 24, bottom: 28, left: 16, containLabel: true },
      tooltip: { show: false },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#6B7280', fontSize: 11 } },
      yAxis: { type: 'value', name: '万元', axisLabel: { color: '#6B7280', fontSize: 11 }, splitLine: { lineStyle: { color: '#E5E7EB', type: 'dashed' } } },
      series: [{
        type: 'bar',
        data: values.map((v, i) => ({ value: v, itemStyle: { color: seriesColors[i], borderRadius: [4, 4, 0, 0] } })),
        barWidth: '32%',
      }],
    })
    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    chart.dispose()
    return new ImageRun({ type: 'png', data: dataUrl.split(',')[1] ?? '', transformation: { width: W, height: H } })
  } catch {
    return null // 取数失败/无权限：降级为文字占位，不阻断整体导出
  } finally {
    if (container && container.parentNode) container.parentNode.removeChild(container)
  }
}

// ============ Word（.docx）导出 ============

export async function exportReportToDocx(data: ReportExportData): Promise<void> {
  const [
    { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, LevelFormat },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const runsToTextRuns = (runs: InlineRun[], defaults: { size?: number; color?: string; italics?: boolean } = {}) =>
    runs.map((r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic ?? defaults.italics,
        underline: r.underline ? {} : undefined,
        strike: r.strike,
        highlight: r.highlight ? 'yellow' : undefined,
        font: r.code ? 'Consolas' : undefined,
        size: r.code ? 18 : (defaults.size ?? 22),
        color: r.code ? 'C7254E' : defaults.color,
        break: r.breakBefore,
      }),
    )

  // 解析全部章节块（含每章表格/列表结构）
  const parsedSections = data.sections.map((s) => ({
    title: s.title,
    missing: s.missing,
    blocks: s.missing ? [] : parseSectionHtml(s.content),
  }))

  // 有序列表 numbering 配置：每个有序列表独立引用，保证各自从 1 起
  const numberingConfig = parsedSections.flatMap((sec, si) =>
    sec.blocks
      .map((b, bi) => ({ b, ref: `report-ol-${si}-${bi}` }))
      .filter(({ b }) => b.kind === 'list' && b.ordered)
      .map(({ ref }) => ({
        reference: ref,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      })),
  )

  // 段落与表格/图片块按文档流顺序写入同一 children（docx sections children 支持混排）
  const bodyChildren: Array<DocxParagraph | DocxTable> = []

  bodyChildren.push(
    new Paragraph({ text: data.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${data.scopeName ?? ''}｜财年 ${data.fiscalYear}｜期间 ${data.period}`, size: 20, color: '666666' })],
    }),
    new Paragraph({ text: '' }),
  )
  // 目录（章节标题清单）
  if (data.sections.length > 0) {
    bodyChildren.push(new Paragraph({ text: '目录', heading: HeadingLevel.HEADING_1 }))
    data.sections.forEach((s, idx) => {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: `${idx + 1}. ${s.title}`, size: 22 })] }))
    })
    bodyChildren.push(new Paragraph({ text: '' }))
  }

  for (let si = 0; si < parsedSections.length; si++) {
    const sec = parsedSections[si]
    bodyChildren.push(new Paragraph({ text: `${si + 1}. ${sec.title}`, heading: HeadingLevel.HEADING_2 }))
    if (sec.missing) {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: '（该单项分析原文已删除）', size: 22, color: '999999' })] }))
      bodyChildren.push(new Paragraph({ text: '' }))
      continue
    }
    if (sec.blocks.length === 0) {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: '（暂无内容）', size: 22, color: '999999' })] }))
      bodyChildren.push(new Paragraph({ text: '' }))
      continue
    }
    for (let bi = 0; bi < sec.blocks.length; bi++) {
      const block = sec.blocks[bi]
      if (block.kind === 'heading') {
        bodyChildren.push(new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: runsToTextRuns(block.runs),
        }))
      } else if (block.kind === 'paragraph') {
        bodyChildren.push(new Paragraph({ children: runsToTextRuns(block.runs) }))
      } else if (block.kind === 'list') {
        block.items.forEach((item) => {
          bodyChildren.push(new Paragraph({
            children: runsToTextRuns(item),
            ...(block.ordered
              ? { numbering: { reference: `report-ol-${si}-${bi}`, level: 0 } }
              : { bullet: { level: 0 } }),
          }))
        })
      } else if (block.kind === 'quote') {
        bodyChildren.push(new Paragraph({
          indent: { left: 720 },
          children: runsToTextRuns(block.runs, { italics: true, color: '666666' }),
        }))
      } else if (block.kind === 'code') {
        block.text.split('\n').forEach((line) => {
          bodyChildren.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18, color: 'C7254E' })] }))
        })
      } else if (block.kind === 'table') {
        const rows = block.rows.map((cells, ri) =>
          new TableRow({
            children: cells.map((cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, bold: block.headerRow && ri === 0 })] })],
              }),
            ),
          }),
        )
        bodyChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
        bodyChildren.push(new Paragraph({ text: '' })) // 表格与后续内容间距
      } else if (block.kind === 'image') {
        const imageRun = await toDocxImageRun(block.src)
        if (imageRun) {
          bodyChildren.push(new Paragraph({ children: [imageRun] }))
        } else {
          bodyChildren.push(new Paragraph({ children: [new TextRun({ text: '（图片导出失败）', size: 18, color: '999999' })] }))
        }
      } else if (block.kind === 'chart') {
        const imageRun = await toDocxChartImageRun(block.attrs)
        if (imageRun) {
          bodyChildren.push(new Paragraph({ children: [imageRun] }))
        } else {
          bodyChildren.push(new Paragraph({ children: [new TextRun({ text: `（图表「${block.attrs.title || block.attrs.subjectCode}」导出失败，详见系统在线查看）`, size: 18, color: '999999' })] }))
        }
      }
    }
    bodyChildren.push(new Paragraph({ text: '' }))
  }
  bodyChildren.push(new Paragraph({ children: [new TextRun({ text: `生成时间：${new Date(data.generatedAt).toLocaleString('zh-CN')}`, italics: true, size: 18, color: '999999' })] }))

  const doc = new Document({
    numbering: numberingConfig.length > 0 ? { config: numberingConfig } : undefined,
    sections: [{ children: bodyChildren }],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${safeFilename(data.title)}.docx`)
}

// ============ PDF 导出（文本方案：标题层级/列表缩进/表格文本；图片不嵌入） ============

/** 中文字体 base64 模块级缓存，避免重复 fetch/转码（TTF 本体仅在首次导出 PDF 时按需下载） */
let fontBase64: string | null = null

async function loadChineseFont(doc: jsPDF): Promise<void> {
  if (!fontBase64) {
    const buf = await (await fetch(notoSansScUrl)).arrayBuffer()
    const bytes = new Uint8Array(buf)
    const chunks: string[] = []
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
    }
    fontBase64 = btoa(chunks.join(''))
  }
  doc.addFileToVFS('NotoSansSC-Regular.ttf', fontBase64)
  doc.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'normal')
  // 同一文件兼作 bold 样式，避免后续 setFont(..., 'bold') 报缺字体
  doc.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'bold')
}

export async function exportReportToPdf(data: ReportExportData): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  await loadChineseFont(doc)
  doc.setFont('NotoSansSC')
  const margin = 48
  const indent = 16
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = margin

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
  }

  const writeLines = (text: string, opts: { size: number; bold?: boolean; indentX?: number; color?: [number, number, number] } ) => {
    doc.setFontSize(opts.size)
    doc.setFont('NotoSansSC', opts.bold ? 'bold' : 'normal')
    if (opts.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2])
    else doc.setTextColor(0, 0, 0)
    const x = margin + (opts.indentX ?? 0)
    const lines = doc.splitTextToSize(text || ' ', pageWidth - margin * 2 - (opts.indentX ?? 0)) as string[]
    for (const line of lines) {
      ensureSpace(opts.size + 5)
      doc.text(line, x, y)
      y += opts.size + 5
    }
  }

  writeLines(data.title || '分析报告', { size: 18, bold: true })
  writeLines(`${data.scopeName ?? ''}｜财年 ${data.fiscalYear}｜期间 ${data.period}`, { size: 10, color: [102, 102, 102] })
  y += 8

  data.sections.forEach((s, idx) => {
    ensureSpace(30)
    writeLines(`${idx + 1}. ${s.title}`, { size: 13, bold: true })
    if (s.missing) {
      writeLines('（该单项分析原文已删除）', { size: 10, color: [153, 153, 153] })
      y += 6
      return
    }
    const blocks = parseSectionHtml(s.content)
    if (blocks.length === 0) {
      writeLines('（暂无内容）', { size: 10, color: [153, 153, 153] })
      y += 6
      return
    }
    blocks.forEach((block) => {
      if (block.kind === 'heading') {
        writeLines(runsToPlainText(block.runs), { size: block.level === 1 ? 12 : 11, bold: true })
      } else if (block.kind === 'paragraph') {
        writeLines(runsToPlainText(block.runs), { size: 10 })
      } else if (block.kind === 'list') {
        block.items.forEach((item, i) => {
          writeLines(`${block.ordered ? `${i + 1}.` : '•'} ${runsToPlainText(item)}`, { size: 10, indentX: indent })
        })
      } else if (block.kind === 'quote') {
        writeLines(runsToPlainText(block.runs), { size: 10, indentX: indent, color: [102, 102, 102] })
      } else if (block.kind === 'code') {
        block.text.split('\n').forEach((line) => writeLines(line, { size: 9, indentX: indent, color: [199, 37, 78] }))
      } else if (block.kind === 'table') {
        block.rows.forEach((cells, ri) => {
          writeLines(cells.join('  |  '), { size: 9, bold: block.headerRow && ri === 0 })
        })
        y += 4
      } else if (block.kind === 'image') {
        writeLines('（图片详见 Word 导出）', { size: 9, color: [153, 153, 153] })
      } else if (block.kind === 'chart') {
        writeLines(`（图表「${block.attrs.title || block.attrs.subjectCode}」详见 Word 导出或系统在线查看）`, { size: 9, color: [153, 153, 153] })
      }
    })
    y += 8
  })

  ensureSpace(14)
  writeLines(`生成时间：${new Date(data.generatedAt).toLocaleString('zh-CN')}`, { size: 9, color: [153, 153, 153] })

  doc.save(`${safeFilename(data.title)}.pdf`)
}
