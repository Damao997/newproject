import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

/**
 * 全局错误边界：捕获子树渲染异常（含 lazy 路由模块链接失败），
 * 渲染友好错误卡 + 重试按钮，避免整页白屏。风格对齐 RequirePermission 的 403 卡。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 保留原始堆栈便于开发期定位（生产环境同样只输出到控制台，不外传）
    console.error('[ErrorBoundary] 页面渲染出错：', error, info.componentStack)
  }

  private retry = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="animate-fade-in w-full max-w-md border border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
              <TriangleAlert className="h-7 w-7 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">页面渲染出错</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              页面加载过程中出现异常，请重试；若反复出现请联系管理员。
            </p>
            {this.state.message && (
              <p className="mt-2 max-w-full truncate text-xs text-muted-foreground" title={this.state.message}>
                {this.state.message}
              </p>
            )}
            <Button className="mt-5" onClick={this.retry}>重试</Button>
          </CardContent>
        </Card>
      </div>
    )
  }
}
