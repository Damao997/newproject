import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, Heading3, List, ListOrdered, Quote, Undo, Redo, Link as LinkIcon,
  RemoveFormatting, Sparkles, X, Check, Loader2, Highlighter, ImagePlus, Table as TableIcon, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeForDisplay } from '@/lib/sanitize'
import { useAiStream } from '@/hooks/use-ai-stream'
import { api } from '@/lib/api'
import { LinkDialog } from './link-dialog'
import { ChartNode, ChartInsertDialog, type ChartAttrs } from './chart-node'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

/**
 * TipTap 富文本编辑器（受控）。
 * 工具栏：加粗/斜体/下划线/标题/列表/引用/高亮/表格/图表/图片/链接/清除格式/撤销重做；可选 AI 润色。
 * 图片：经后端上传（POST /reports/uploads）返回站内相对 URL 后插入；粘贴图片文件同样走上传。
 * 图表：ChartNode Atom 节点（chart-node.tsx），编辑器需传 chartContext 提供公司/期间默认值。
 * 内容变更通过 onChange 回传 HTML；外部 value 变化时同步（避免光标跳动仅在差异时 setContent）。
 */

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  editable?: boolean
  /** 开启工具栏“AI 润色”按钮（选中文本→侧栏流式预览→确认替换） */
  polishEnabled?: boolean
  /** 图表插入上下文（公司/期间默认值）；缺省时隐藏“图表”按钮 */
  chartContext?: { companyCode: string; period: string }
}

function ToolButton({ onClick, active, disabled, title, children }: { onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-muted text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** 表格菜单：插入 3×3 / 行列增删 / 删除表格（行列操作仅在光标位于表格内时可用） */
function TableMenu({ editor }: { editor: Editor }) {
  const inTable = editor.isActive('table')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="表格"
          aria-label="表格"
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            inTable && 'bg-muted text-foreground',
          )}
        >
          <TableIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled={inTable} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 插入 3×3 表格
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 在下方插入行
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 在右侧插入列
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!editor.can().deleteRow()} onClick={() => editor.chain().focus().deleteRow().run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 删除行
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!editor.can().deleteColumn()} onClick={() => editor.chain().focus().deleteColumn().run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 删除列
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!editor.can().deleteTable()} onClick={() => editor.chain().focus().deleteTable().run()}>
          <TableIcon className="mr-2 h-4 w-4" /> 删除表格
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Toolbar({ editor, onPolish, onEditLink, onInsertImage, onInsertChart, imageUploading }: {
  editor: Editor
  onPolish?: () => void
  onEditLink: () => void
  onInsertImage: () => void
  onInsertChart?: () => void
  imageUploading: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      <ToolButton title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolButton>
      <ToolButton title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolButton>
      <ToolButton title="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolButton>
      <ToolButton title="标题2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolButton>
      <ToolButton title="标题3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolButton>
      <ToolButton title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolButton>
      <ToolButton title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolButton>
      <ToolButton title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></ToolButton>
      <ToolButton title="高亮" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter className="h-4 w-4" /></ToolButton>
      <TableMenu editor={editor} />
      {onInsertChart && (
        <ToolButton title="插入数据图表" active={editor.isActive('chart')} onClick={onInsertChart}><BarChart3 className="h-4 w-4" /></ToolButton>
      )}
      <ToolButton title={imageUploading ? '图片上传中…' : '插入图片'} disabled={imageUploading} onClick={onInsertImage}>
        {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
      </ToolButton>
      <ToolButton title="链接" active={editor.isActive('link')} onClick={onEditLink}><LinkIcon className="h-4 w-4" /></ToolButton>
      <ToolButton title="清除格式" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}><RemoveFormatting className="h-4 w-4" /></ToolButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolButton title="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo className="h-4 w-4" /></ToolButton>
      <ToolButton title="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo className="h-4 w-4" /></ToolButton>
      {onPolish && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            title="AI 润色（先选中文本）"
            onClick={onPolish}
            className="flex h-7 items-center gap-1 rounded px-2 text-helper text-primary transition-colors hover:bg-primary/10"
          >
            <Sparkles className="h-3.5 w-3.5" /> AI 润色
          </button>
        </>
      )}
    </div>
  )
}

type PolishStyle = 'formal' | 'concise' | 'plain'
const STYLE_LABEL: Record<PolishStyle, string> = { formal: '正式', concise: '简明', plain: '通俗' }

/** AI 润色侧栏：流式预览润色结果，确认后替换选区（不直接覆盖） */
function PolishPanel({
  original,
  onApply,
  onClose,
}: {
  original: string
  onApply: (text: string) => void
  onClose: () => void
}) {
  const [style, setStyle] = useState<PolishStyle>('formal')
  const [finalText, setFinalText] = useState('')
  const styleRef = useRef<PolishStyle>('formal')
  // body 用函数形式：start 发起时求值，保证切换风格后立即生效（不依赖重渲染时序）
  const ai = useAiStream({
    path: '/ai/polish',
    body: () => ({ text: original, style: styleRef.current }),
    onDone: (ft) => setFinalText(ft || ''),
  })

  const run = (s: PolishStyle) => {
    styleRef.current = s
    setStyle(s)
    setFinalText('')
    ai.start()
  }

  useEffect(() => {
    run('formal')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const result = finalText || ai.preview
  return (
    <div className="flex w-72 shrink-0 flex-col border-l bg-muted/20">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1 text-body font-medium text-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI 润色</span>
        <button type="button" onClick={onClose} aria-label="关闭" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        {(Object.keys(STYLE_LABEL) as PolishStyle[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={ai.streaming}
            onClick={() => run(s)}
            className={cn('rounded px-2 py-0.5 text-helper transition-colors', style === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {STYLE_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-body leading-relaxed text-foreground" aria-live="polite">
        {ai.error ? (
          <span className="text-destructive">{ai.error}</span>
        ) : result ? (
          <p className="whitespace-pre-wrap">{result}</p>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中…</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-helper text-muted-foreground hover:bg-muted">取消</button>
        <button
          type="button"
          disabled={ai.streaming || !finalText}
          onClick={() => onApply(finalText)}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-helper text-primary-foreground disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> 替换选区
        </button>
      </div>
    </div>
  )
}

export function RichTextEditor({ value, onChange, placeholder, className, editable = true, polishEnabled = false, chartContext }: RichTextEditorProps) {
  const [polish, setPolish] = useState<{ from: number; to: number; text: string } | null>(null)
  // 链接编辑对话框（替代原生 prompt）：打开时回填当前链接
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; initialUrl: string }>({ open: false, initialUrl: 'https://' })
  // 图表插入对话框
  const [chartDialogOpen, setChartDialogOpen] = useState(false)
  // 操作引导轻提示（替代原生 alert）：2.5s 自动消失；对象 state 保证同文案重复触发时也重置计时
  const [hint, setHint] = useState<{ text: string; key: number } | null>(null)
  // 图片上传中标记（工具栏按钮转圈）
  const [imageUploading, setImageUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // editorProps.handlePaste 在编辑器创建时固化，须经 ref 读取最新的 editable / editor 实例
  const editableRef = useRef(editable)
  const editorRef = useRef<Editor | null>(null)
  useEffect(() => { editableRef.current = editable }, [editable])

  /** 上传图片文件并插入编辑器（工具栏选图与粘贴共用；失败走轻提示，不中断编辑） */
  const uploadAndInsertImages = async (files: File[]) => {
    setImageUploading(true)
    try {
      for (const file of files) {
        try {
          const { url } = await api.uploadReportImage(file)
          editorRef.current?.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') }).run()
        } catch (e) {
          setHint({ text: `图片「${file.name}」上传失败：${(e as Error).message || '未知错误'}`, key: Date.now() })
        }
      }
    } finally {
      setImageUploading(false)
    }
  }

  const editor = useEditor({
    extensions: [
      // StarterKit v3 已内置 underline/link，link 在此统一配置避免重复注册
      StarterKit.configure({
        link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      Highlight,
      Image,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      ChartNode,
    ],
    // DOMPurify 展示前二次净化（纵深防御，兑现安全规范 §8.2；TipTap schema 白名单为主防线）
    content: sanitizeForDisplay(value),
    editable,
    editorProps: {
      attributes: {
        class: 'prose-editor min-h-[200px] max-w-none px-3 py-2 text-body text-foreground focus:outline-none',
        'data-placeholder': placeholder ?? '请输入分析内容…',
      },
      // 粘贴图片文件：拦截默认行为，上传后以站内相对 URL 插入（仅可编辑态）
      handlePaste: (_view, event) => {
        if (!editableRef.current) return false
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        void uploadAndInsertImages(files)
        return true
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // 外部 value 变化时同步（仅在差异时重置，避免光标跳动）；同步前净化，防历史脏数据入编辑器
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(sanitizeForDisplay(value), { emitUpdate: false })
    }
  }, [value, editor])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editable, editor])

  // 轻提示 2.5s 自动消失
  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => setHint(null), 2500)
    return () => window.clearTimeout(t)
  }, [hint])

  if (!editor) return null

  const handlePolish = () => {
    const { from, to } = editor.state.selection
    if (from === to) {
      setHint({ text: '请先在编辑器中选中需润色的文本。', key: Date.now() })
      return
    }
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) {
      setHint({ text: '选区为空，无可润色的文本。', key: Date.now() })
      return
    }
    setPolish({ from, to, text })
  }

  const openLinkDialog = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    setLinkDialog({ open: true, initialUrl: previous ?? 'https://' })
  }

  const confirmLink = (url: string) => {
    setLinkDialog((s) => ({ ...s, open: false }))
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const applyPolish = (polished: string) => {
    if (!polish) return
    editor.chain().focus().insertContentAt({ from: polish.from, to: polish.to }, polished).run()
    setPolish(null)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    e.target.value = '' // 允许连续选择同一文件
    if (files.length > 0) void uploadAndInsertImages(files)
  }

  const insertChart = (attrs: ChartAttrs) => {
    editor.chain().focus().insertContent({ type: 'chart', attrs }).run()
  }

  return (
    <div className={cn('overflow-hidden rounded-md border bg-background', className)}>
      {editable && (
        <Toolbar
          editor={editor}
          onPolish={polishEnabled ? handlePolish : undefined}
          onEditLink={openLinkDialog}
          onInsertImage={() => fileInputRef.current?.click()}
          onInsertChart={chartContext ? () => setChartDialogOpen(true) : undefined}
          imageUploading={imageUploading}
        />
      )}
      {hint && (
        <p role="status" className="border-t px-3 py-1.5 text-helper text-muted-foreground">{hint.text}</p>
      )}
      <div className="flex">
        <div className="min-w-0 flex-1">
          <EditorContent editor={editor} />
        </div>
        {polish && (
          <PolishPanel original={polish.text} onApply={applyPolish} onClose={() => setPolish(null)} />
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      {chartContext && (
        <ChartInsertDialog
          open={chartDialogOpen}
          onClose={() => setChartDialogOpen(false)}
          onInsert={insertChart}
          defaultCompanyCode={chartContext.companyCode}
          defaultPeriod={chartContext.period}
        />
      )}
      <LinkDialog
        open={linkDialog.open}
        initialUrl={linkDialog.initialUrl}
        onConfirm={confirmLink}
        onCancel={() => setLinkDialog((s) => ({ ...s, open: false }))}
      />
    </div>
  )
}
