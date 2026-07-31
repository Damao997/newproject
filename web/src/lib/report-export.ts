import type { Paragraph as DocxParagraph } from 'docx'
import type { ReportExportData } from '@/lib/api'

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

/** 导出 PDF（jspdf 内置字体不含中文，正文以英文/数字为主时可读；中文环境建议优先 Word） */
export async function exportReportToPdf(data: ReportExportData): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
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
  doc.text(encodeURIComponent(data.title).length > 0 ? data.title : 'Report', margin, y)
  y += 24
  doc.setFontSize(10)
  doc.text(`${data.scopeName ?? ''} | FY ${data.fiscalYear} | ${data.period}`, margin, y)
  y += 24

  data.sections.forEach((s, idx) => {
    ensureSpace(30)
    doc.setFontSize(13)
    doc.text(`${idx + 1}. ${s.title}`, margin, y)
    y += 18
    doc.setFontSize(10)
    const body = s.missing ? '(source analysis deleted)' : s.plainText || '(no content)'
    const lines = doc.splitTextToSize(body, pageWidth - margin * 2) as string[]
    for (const line of lines) {
      ensureSpace(14)
      doc.text(line, margin, y)
      y += 14
    }
    y += 8
  })

  doc.save(`${safeFilename(data.title)}.pdf`)
}
