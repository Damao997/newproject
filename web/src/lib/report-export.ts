import type { jsPDF } from 'jspdf'
import type { Paragraph as DocxParagraph } from 'docx'
import type { ReportExportData } from '@/lib/api'
import notoSansScUrl from '@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf?url'

/**
 * 汇总分析报告导出：依据后端返回的结构化章节数据，前端生成 Word(docx) / PDF。
 * 正文使用后端已净化的纯文本（plainText），避免富文本注入风险。
 *
 * docx（~400KB）/ jspdf（含 html2canvas ~200KB）/ file-saver 均在函数内
 * 动态 import —— 导出为低频操作，不应计入报告页首屏体积。
 * 类型以 `import type` 引入（编译期擦除，无运行时开销）。
 */

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '分析报告'
}

/** 导出 Word（.docx） */
export async function exportReportToDocx(data: ReportExportData): Promise<void> {
  const [
    { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const children: DocxParagraph[] = []
  children.push(
    new Paragraph({ text: data.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${data.scopeName ?? ''}｜财年 ${data.fiscalYear}｜期间 ${data.period}`, size: 20, color: '666666' })],
    }),
    new Paragraph({ text: '' }),
  )
  // 目录（章节标题清单）
  if (data.sections.length > 0) {
    children.push(new Paragraph({ text: '目录', heading: HeadingLevel.HEADING_1 }))
    data.sections.forEach((s, idx) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${idx + 1}. ${s.title}`, size: 22 })] }))
    })
    children.push(new Paragraph({ text: '' }))
  }
  data.sections.forEach((s, idx) => {
    children.push(new Paragraph({ text: `${idx + 1}. ${s.title}`, heading: HeadingLevel.HEADING_2 }))
    const body = s.missing ? '（该单项分析原文已删除）' : s.plainText || '（暂无内容）'
    body.split('\n').forEach((line) => {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }))
    })
    children.push(new Paragraph({ text: '' }))
  })
  children.push(new Paragraph({ children: [new TextRun({ text: `生成时间：${new Date(data.generatedAt).toLocaleString('zh-CN')}`, italics: true, size: 18, color: '999999' })] }))

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${safeFilename(data.title)}.docx`)
}

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

/** 导出 PDF（嵌入 Noto Sans SC 中文字体，字体文件在导出时按需加载并缓存） */
export async function exportReportToPdf(data: ReportExportData): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  await loadChineseFont(doc)
  doc.setFont('NotoSansSC')
  const margin = 48
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = margin

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
  }

  doc.setFontSize(18)
  doc.text(data.title || '分析报告', margin, y)
  y += 24
  doc.setFontSize(10)
  doc.text(`${data.scopeName ?? ''}｜财年 ${data.fiscalYear}｜期间 ${data.period}`, margin, y)
  y += 24

  data.sections.forEach((s, idx) => {
    ensureSpace(30)
    doc.setFontSize(13)
    doc.text(`${idx + 1}. ${s.title}`, margin, y)
    y += 18
    doc.setFontSize(10)
    const body = s.missing ? '（该单项分析原文已删除）' : s.plainText || '（暂无内容）'
    const lines = doc.splitTextToSize(body, pageWidth - margin * 2) as string[]
    for (const line of lines) {
      ensureSpace(14)
      doc.text(line, margin, y)
      y += 14
    }
    y += 8
  })

  ensureSpace(14)
  doc.setFontSize(9)
  doc.text(`生成时间：${new Date(data.generatedAt).toLocaleString('zh-CN')}`, margin, y)

  doc.save(`${safeFilename(data.title)}.pdf`)
}
