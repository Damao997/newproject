/**
 * AI 预分析报告纯文本 → 结构化渲染（独立文件：保持组件文件纯组件导出，兼容 fast refresh）。
 *
 * - "一、…" 分节标题行 → 加粗段落（视觉层级）
 * - "| a | b |" markdown 表格行 → 简单表格（首行为表头，分隔行跳过）
 * - 其余 → 段落
 * 文本经 React 自动转义（XSS 安全）。
 */

export function renderOverviewText(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let tableRows: string[] | null = null
  let key = 0

  const flushTable = () => {
    if (!tableRows) return
    // 拆分单元格并去除分隔行（|---|---|）
    const dataRows = tableRows
      .map((row) => row.split('|').map((cell) => cell.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1))
      .filter((cells) => !cells.every((c) => /^-+$/.test(c)))
    if (dataRows.length > 0) {
      nodes.push(
        <div key={key++} className="my-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className={ri === 0 ? 'bg-muted/50' : undefined}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border px-2 py-1">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    }
    tableRows = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushTable()
      continue
    }
    if (/^\|.*\|$/.test(line)) {
      tableRows = tableRows ?? []
      tableRows.push(line)
      continue
    }
    flushTable()
    if (/^[一二三四五六七八九十]+、/.test(line)) {
      nodes.push(<p key={key++} className="mt-1 font-semibold text-foreground">{line}</p>)
    } else {
      nodes.push(<p key={key++} className="text-foreground">{line}</p>)
    }
  }
  flushTable()
  return nodes
}
