import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Quote, Undo, Redo, Link as LinkIcon, RemoveFormatting, Sparkles, X, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { streamAI, type StreamController } from '@/lib/ai-stream'

/**
 * TipTap 富文本编辑器（受控）。
 * 工具栏：加粗/斜体/标题/列表/引用/链接/清除格式/撤销重做；可选 AI 润色。
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
}

function ToolButton({ onClick, active, disabled, title, children }: { onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
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

function Toolbar({ editor, onPolish }: { editor: Editor; onPolish?: () => void }) {
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('链接地址', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      <ToolButton title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolButton>
      <ToolButton title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolButton>
      <ToolButton title="标题2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolButton>
      <ToolButton title="标题3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolButton>
      <ToolButton title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolButton>
      <ToolButton title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolButton>
      <ToolButton title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></ToolButton>
      <ToolButton title="链接" active={editor.isActive('link')} onClick={setLink}><LinkIcon className="h-4 w-4" /></ToolButton>
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
            className="flex h-7 items-center gap-1 rounded px-2 text-[12px] text-primary transition-colors hover:bg-primary/10"
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
  const [streaming, setStreaming] = useState(false)
  const [preview, setPreview] = useState('')
  const [finalText, setFinalText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<StreamController | null>(null)

  const run = (s: PolishStyle) => {
    setStyle(s)
    setStreaming(true)
    setPreview('')
    setFinalText('')
    setError(null)
    ctrlRef.current?.abort()
    ctrlRef.current = streamAI('/ai/polish', { text: original, style: s }, {
      onToken: (d) => setPreview((p) => p + d),
      onDone: (ft) => { setFinalText(ft || ''); setStreaming(false) },
      onError: (msg) => { setError(msg); setStreaming(false) },
    })
  }

  useEffect(() => {
    run('formal')
    return () => ctrlRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const result = finalText || preview
  return (
    <div className="flex w-72 shrink-0 flex-col border-l bg-muted/20">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1 text-[13px] font-medium text-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI 润色</span>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        {(Object.keys(STYLE_LABEL) as PolishStyle[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={streaming}
            onClick={() => run(s)}
            className={cn('rounded px-2 py-0.5 text-[12px] transition-colors', style === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {STYLE_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-[13px] leading-relaxed text-foreground">
        {error ? (
          <span className="text-finance-red">{error}</span>
        ) : result ? (
          <p className="whitespace-pre-wrap">{result}</p>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中…</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted">取消</button>
        <button
          type="button"
          disabled={streaming || !finalText}
          onClick={() => onApply(finalText)}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[12px] text-primary-foreground disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> 替换选区
        </button>
      </div>
    </div>
  )
}

export function RichTextEditor({ value, onChange, placeholder, className, editable = true, polishEnabled = false }: RichTextEditorProps) {
  const [polish, setPolish] = useState<{ from: number; to: number; text: string } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
    content: value,
    editable,
    editorProps: {
      attributes: {
        class: 'prose-editor min-h-[200px] max-w-none px-3 py-2 text-[13px] text-black focus:outline-none',
        'data-placeholder': placeholder ?? '请输入分析内容…',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })

  // 外部 value 变化时同步（仅在差异时重置，避免光标跳动）
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [value, editor])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editable, editor])

  if (!editor) return null

  const handlePolish = () => {
    const { from, to } = editor.state.selection
    if (from === to) {
      window.alert('请先在编辑器中选中需润色的文本。')
      return
    }
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) {
      window.alert('选区为空，无可润色的文本。')
      return
    }
    setPolish({ from, to, text })
  }

  const applyPolish = (polished: string) => {
    if (!polish) return
    editor.chain().focus().insertContentAt({ from: polish.from, to: polish.to }, polished).run()
    setPolish(null)
  }

  return (
    <div className={cn('overflow-hidden rounded-md border bg-background', className)}>
      {editable && <Toolbar editor={editor} onPolish={polishEnabled ? handlePolish : undefined} />}
      <div className="flex">
        <div className="min-w-0 flex-1">
          <EditorContent editor={editor} />
        </div>
        {polish && (
          <PolishPanel original={polish.text} onApply={applyPolish} onClose={() => setPolish(null)} />
        )}
      </div>
    </div>
  )
}
