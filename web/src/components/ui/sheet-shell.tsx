import type { ReactNode } from 'react'
import { Drawer } from 'antd'
import { cn } from '@/lib/utils'

interface SheetShellProps {
  /** 关闭回调：遮罩点击 / 关闭按钮 / Escape 均触发（父组件负责未保存修改确认） */
  onClose: () => void
  /** 标题区图标（可选） */
  icon?: ReactNode
  /** 抽屉标题 */
  title: string
  /** 标题区副标题（可选） */
  description?: ReactNode
  /** 中间内容区（flex-1 内部滚动） */
  children: ReactNode
  /** 底部操作栏（可选，border-t 分隔） */
  footer?: ReactNode
  /** 容器宽度等覆盖类名（如 max-w-md 收窄） */
  className?: string
}

/**
 * 右侧抽屉共享外壳：antd Drawer（遮罩/关闭/Escape/焦点管理为 antd 原生行为）。
 * 调用方条件挂载（open 时渲染）→ Drawer 恒为 open；宽度缺省 576px（max-w-xl），
 * className 的 max-w-* 可继续收窄；body 置零 padding 且纵向 flex，交由调用方内容自治布局。
 */
export function SheetShell({ onClose, icon, title, description, children, footer, className }: SheetShellProps) {
  return (
    <Drawer
      open
      onClose={onClose}
      placement="right"
      width={576}
      destroyOnClose
      className={cn(className)}
      title={
        <div className="flex min-w-0 items-start gap-2">
          {icon}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {description && <p className="text-body text-muted-foreground">{description}</p>}
          </div>
        </div>
      }
      footer={footer ? <div className="flex items-center justify-between">{footer}</div> : null}
      styles={{
        header: { padding: '14px 20px' },
        body: { padding: 0, display: 'flex', flexDirection: 'column' },
        footer: { padding: '12px 20px' },
      }}
    >
      {children}
    </Drawer>
  )
}
