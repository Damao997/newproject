import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { ShieldAlert, LogOut, Home, MessageSquare } from 'lucide-react'
import { resolveHomePath } from '@/lib/permissions'

const ROLE_LABEL: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '系统管理员',
  finance_manager: '财务总监',
  department_manager: '部门负责人',
  finance_analyst_it: '财务分析师',
  viewer: '只读用户',
}

const ROLE_DEPT: Record<string, string> = {
  superadmin: '信息技术部 / 系统组',
  admin: '信息技术部 / 系统组',
  finance_manager: '财务部 / 财务核算组',
  department_manager: '运营管理部 / 业务组',
  finance_analyst_it: '财务部 / 数据分析组',
  viewer: '业务部门 / 内勤组',
}

export default function NoAccessPage() {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const handleBackHome = () => {
    const home = resolveHomePath(user?.permissions)
    if (home) navigate(home)
  }

  const handleContactAdmin = () => {
    window.open('mailto:admin@example.com', '_self')
  }

  const hasHome = !!resolveHomePath(user?.permissions)

  const displayName = user?.name ?? user?.username ?? '未登录用户'
  const roleLabel = user?.role ? ROLE_LABEL[user.role] ?? user.role : '普通用户'
  const deptLabel = user?.role ? ROLE_DEPT[user.role] ?? '业务部门 / 默认组' : '业务部门 / 默认组'
  const avatarChar = displayName.slice(0, 1)

  return (
    <div className="noaccess-shell">
      <aside className="noaccess-side">
        {/* 顶部光晕装饰：与设计稿蓝色调呼应 */}
        <div className="noaccess-side-glow" aria-hidden />
        {/* 数据平台装饰点阵 */}
        <div className="noaccess-side-dots" aria-hidden />

        <div className="noaccess-brand">
          <div className="noaccess-brand-mark">J</div>
          <div className="noaccess-brand-name">经营数据分析平台</div>
        </div>

        <div className="noaccess-pitch">
          <h1>
            安全访问
            <br />
            按需授权
          </h1>
          <p>
            本平台采用基于角色的访问控制 (RBAC)，所有模块均按岗位职责分配权限。如需访问受限模块，请联系系统管理员提交授权申请。
          </p>
          {/* 安全特性标签条：增强视觉信息密度，对齐设计稿意图 */}
          <ul className="noaccess-features">
            <li>
              <span className="noaccess-features-dot" />
              数据隔离
            </li>
            <li>
              <span className="noaccess-features-dot" />
              操作审计
            </li>
            <li>
              <span className="noaccess-features-dot" />
              会话加密
            </li>
          </ul>
        </div>

        <div className="noaccess-foot">© 2026 经营数据分析平台 · v2.6.1 · 安全等级 B+</div>
      </aside>

      <section className="noaccess-content">
        {/* 浅色背景纹理（对齐设计稿右侧浅灰底） */}
        <div className="noaccess-content-bg" aria-hidden />
        <div className="noaccess-card">
          <div className="antd-state-illustration">
            <span className="antd-state-illustration-ring r2" />
            <span className="antd-state-illustration-ring r1" />
            <ShieldAlert className="antd-state-illustration-icon" strokeWidth={1.5} />
          </div>

          <h2 className="noaccess-title">您当前没有访问该模块的权限</h2>
          <p className="noaccess-sub">如需访问请联系系统管理员申请授权</p>

          <div className="noaccess-user">
            <div className="noaccess-avatar">{avatarChar}</div>
            <div className="noaccess-user-info">
              <div className="noaccess-user-name">
                {displayName}
                <Pill tone="blue">{roleLabel}</Pill>
              </div>
              <div className="noaccess-user-meta">{deptLabel}</div>
            </div>
          </div>

          <div className="noaccess-actions">
            <Button variant="default" className="noaccess-btn-primary" onClick={handleContactAdmin}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              联系管理员
            </Button>
            <Button variant="ghost" className="noaccess-btn-ghost" disabled={!hasHome} onClick={handleBackHome}>
              <Home className="mr-1.5 h-3.5 w-3.5" />
              返回首页
            </Button>
          </div>

          <a
            className="noaccess-logout"
            href="#"
            onClick={(e) => {
              e.preventDefault()
              handleLogout()
            }}
          >
            <LogOut className="noaccess-logout-icon" />
            退出登录
          </a>

          {/* 申请流程：3 步说明 */}
          <div className="noaccess-flow">
            <div className="noaccess-flow-title">申请流程</div>
            <ol className="noaccess-flow-steps">
              <li>
                <span className="noaccess-flow-num">1</span>
                <div className="noaccess-flow-text">
                  <div className="noaccess-flow-step">提交申请</div>
                  <div className="noaccess-flow-desc">说明访问用途与目标模块</div>
                </div>
              </li>
              <li>
                <span className="noaccess-flow-num">2</span>
                <div className="noaccess-flow-text">
                  <div className="noaccess-flow-step">主管审批</div>
                  <div className="noaccess-flow-desc">直属上级 / 部门负责人审核</div>
                </div>
              </li>
              <li>
                <span className="noaccess-flow-num">3</span>
                <div className="noaccess-flow-text">
                  <div className="noaccess-flow-step">开通权限</div>
                  <div className="noaccess-flow-desc">管理员分配并通知</div>
                </div>
              </li>
            </ol>
          </div>

          {/* 联系方式 + 常见原因 */}
          <div className="noaccess-meta">
            <div className="noaccess-meta-item">
              <span className="noaccess-meta-label">管理员</span>
              <span className="noaccess-meta-value">admin@example.com</span>
            </div>
            <div className="noaccess-meta-item">
              <span className="noaccess-meta-label">服务热线</span>
              <span className="noaccess-meta-value">400-888-0001 转 9</span>
            </div>
            <div className="noaccess-meta-item">
              <span className="noaccess-meta-label">常见原因</span>
              <span className="noaccess-meta-value">岗位职责调整 / 新员工入职 / 临时项目授权</span>
            </div>
          </div>

          {/* 可申请模块 */}
          <div className="noaccess-modules">
            <div className="noaccess-modules-title">可申请模块</div>
            <div className="noaccess-modules-grid">
              <span className="noaccess-module-chip">经营总览</span>
              <span className="noaccess-module-chip">收支分析</span>
              <span className="noaccess-module-chip">资产负债</span>
              <span className="noaccess-module-chip">利润分析</span>
              <span className="noaccess-module-chip">现金流</span>
              <span className="noaccess-module-chip">预算管理</span>
              <span className="noaccess-module-chip">科目余额</span>
              <span className="noaccess-module-chip">凭证查询</span>
              <span className="noaccess-module-chip">自定义报表</span>
            </div>
          </div>

          {/* 底部状态条：会话信息 + 时间戳 */}
          <div className="noaccess-status">
            <span className="noaccess-status-dot" />
            会话已加密 · 访问时间 {new Date().toLocaleString('zh-CN', { hour12: false })}
          </div>
        </div>
      </section>
    </div>
  )
}
