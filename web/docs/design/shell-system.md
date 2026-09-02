# 通用壳 · 侧栏 + 顶栏 + 主区

> 4 套侧边栏风格 + 顶栏 + 主体布局 · 财年经营数据分析平台

本文档梳理全站应用框架（App Shell）：侧边栏（4 套风格）、顶栏（Header）、主体（Main）、面包屑、用户菜单、风格切换器。

---

## 1. 整体布局

```
┌─────────────────────────────────────────────────┐
│                  TopBar (56px)                   │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│  Sidebar │              Main                     │
│  (240px) │         (scrollable)                  │
│          │                                       │
│  - 仪表盘 │   PageContainer                       │
│  - 数据   │     ├─ Title + Description          │
│  - 报表   │     ├─ Actions (右上)                │
│  - 交易   │     └─ Content Cards                 │
│  - 权限   │                                       │
│          │                                       │
└──────────┴──────────────────────────────────────┘
```

- **总宽**：1440px（最大） / 100% 视口（最小 1024px）
- **总高**：100vh
- **Sidebar**：固定宽度 240px（可折叠为 64px 仅图标）
- **TopBar**：固定高度 56px
- **Main**：`flex-1` 滚动，主区内边距 24px

---

## 2. 4 套侧边栏风格

### 2.1 Light（默认）— 浅色白底

```
┌──────────────┐
│  ◈ FY200     │  ← 品牌区（白底 + 深色文字）
├──────────────┤
│  ◆ 仪表盘    │  ← 选中：浅橙底 + 橙文字 + 左侧 3px 橙条
│  ◇ 数据      │  ← 默认：深灰文字 + 灰图标
│  ◇ 报表      │
│  ◇ 交易      │
│  ◇ 权限      │
└──────────────┘
```

- **底色**：`#FFFFFF`
- **文字**：`#333333`（默认）/ `#FFB74D`（选中）
- **图标**：`#A3A3A3`（默认）/ `#FFB74D`（选中）
- **选中背景**：`#FFE8CC`（浅橙）
- **左侧 3px 强调条**：`#FFB74D`
- **滚动条**：浅灰 `#C7CCD3`，hover `#A8AEB6`
- **分隔线**：`#E5E7EB`（极淡，几乎不可见）

### 2.2 Gradient — 深紫纯色

```
┌──────────────┐
│  ◈ FY200     │  ← 品牌区（深紫底 + 白字）
├──────────────┤
│  ◆ 仪表盘    │  ← 选中：蓝紫底 (#3D41C6) + 白字
│  ◇ 数据      │  ← 默认：浅紫字
│  ◇ 报表      │
└──────────────┘
```

- **底色**：`#472159`（深紫）
- **文字**：`#EBE6FA`（默认）/ `#FFFFFF`（选中）
- **图标**：`#EBE6FA` / `#FFFFFF`
- **选中背景**：`#3D41C6`（蓝紫）
- **左侧 3px 强调条**：`#FFFFFF`
- **分隔线**：`#623672`
- **风格切换提示**：与"渐变"风格名称匹配，整体呈纯色而非真渐变，避免视觉过载

### 2.3 Dark — 深色背景

```
┌──────────────┐
│  ◈ FY200     │  ← 品牌区（深灰底 + 白字）
├──────────────┤
│  ◆ 仪表盘    │  ← 选中：深灰底 (#1F2937) + 白字
│  ◇ 数据      │  ← 默认：浅灰字
└──────────────┘
```

- **底色**：`#111827`
- **文字**：`#E5E7EB` / `#FFFFFF`
- **图标**：`#9CA3AF` / `#FFFFFF`
- **选中背景**：`#1F2937`
- **左侧 3px 强调条**：`#FFFFFF`
- **分隔线**：`#1F2937`

### 2.4 Antd — Ant Design 深蓝（与 ProTable 联动）

```
┌──────────────┐
│  ◈ FY200     │  ← 品牌区（深蓝底 #001529 + 白字）
├──────────────┤
│  ◆ 仪表盘    │  ← 选中：antd 蓝底 (#1677FF) + 白字
│  ◇ 数据      │  ← 默认：白色
└──────────────┘
```

- **底色**：`#001529`（antd 默认侧栏色）
- **文字**：`#FFFFFF` / `#FFFFFF`
- **图标**：`#FFFFFF` / `#FFFFFF`
- **选中背景**：`#1677FF`（antd 主色）
- **左侧 3px 强调条**：`#1677FF`
- **分隔线**：`#000F1D`

---

## 3. 顶栏（TopBar）

固定高度 56px，白底，1px 下边框，左对齐面包屑，右对齐风格切换器 + 通知 + 用户菜单。

```
┌──────────────────────────────────────────────────────────────┐
│ [≡ 折叠] / 首页 / 数据浏览        主题  搜索  通知  用户 ▾ │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 左侧：折叠按钮 + 面包屑

- **折叠按钮**：24px 方形按钮（侧栏展开/折叠切换）
- **面包屑**：13px + muted-foreground，分隔符 `/`，最后一项高亮

### 3.2 右侧：操作区

- **风格切换器**：4 选 1 切换（`light` / `gradient` / `dark` / `antd`），写入 `html[data-sidebar]`
- **全局搜索**：240px 宽，placeholder "搜索菜单/页面"
- **通知铃铛**：带 Badge（未读数），点击下拉显示最近通知
- **用户菜单**：头像 + 用户名 + 角色，点击下拉（个人中心/修改密码/退出登录）

### 3.3 主题切换实现

**文件**：`web/src/hooks/use-sidebar-style.ts`

```typescript
const [style, setStyle] = useState<SidebarStyle>('light')
useEffect(() => {
  document.documentElement.dataset.sidebar = style
  localStorage.setItem('sidebar-style', style)
}, [style])
```

切换时通过 CSS 变量级联，**无需重新挂载组件**；AntdProvider 内部订阅变化，ProTable/Modal 同步更新。

---

## 4. 主区（Main）

### 4.1 页面容器

所有业务页面统一使用 `PageContainer` 组件，提供：
- 标题 + 描述
- 右上角操作区
- 可选吸顶头
- 面包屑
- 24px 内边距

### 4.2 卡片栅格

基于 CSS Grid，默认 12 列响应式：
- 桌面（≥1024px）：12 列
- 平板（768-1023px）：8 列
- 移动（<768px）：4 列

工具类：`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`

### 4.3 滚动行为

- 主区：垂直滚动
- 侧栏：垂直滚动，吸附式滚动条
- 顶栏：固定不滚动

---

## 5. 侧栏菜单（Sidebar Menu）

### 5.1 数据结构

```typescript
interface MenuItem {
  key: string
  label: string
  icon: LucideIcon
  path?: string           // 直接跳转
  children?: MenuItem[]   // 二级菜单
  badge?: number | string // 角标
  hidden?: boolean        // 权限控制
  permission?: string     // 权限码
}
```

### 5.2 多级菜单

支持 3 级嵌套（实际项目主要用 1-2 级）：
- **一级**：侧栏显示
- **二级**：缩进 16px + 12px 字号
- **三级**：缩进 32px + 11px 字号（极少用）

### 5.3 折叠/展开

- 整栏可折叠为 64px（仅图标）
- 单个菜单组可独立折叠（点击箭头）
- 折叠状态持久化到 `localStorage`

### 5.4 权限过滤

`useMenuPermission` hook 根据当前用户 `permissions` 数组过滤 `hidden: true` 项。

---

## 6. 路由与面包屑

### 6.1 路由

基于 React Router 6，结构：
```
/                     → /dashboard
/login                → LoginPage
/no-access            → NoAccessPage
/dashboard            → DashboardLayout (含侧栏 + 顶栏)
  /                   → DashboardHome
  /data/...           → DataLayout
  /reports/...        → ReportsLayout
  ...
/__design/antd-style  → DesignSnapshotPage (开发用)
```

### 6.2 面包屑生成

通过 `useLocation()` + 路由配置表 `routeMeta` 自动生成：
```typescript
const breadcrumbs = matchPath(location.pathname)?.meta?.breadcrumb ?? []
```

---

## 7. 关键页面

### 7.1 登录页（LoginPage）

**路径**：`/login`  
**布局**：全屏 split 布局
- 左 50%：品牌区（橙渐变 + 大 logo + 营销文案）
- 右 50%：表单区（白底 + 居中表单 + 底部帮助链接）

**响应式**：< 768px 折叠为单列，仅显示表单。

**特殊 palette**：使用独立 `--brand-orange-*` token（`globals.css` 第 425-774 行），与 4 套侧边栏风格**不联动**，保持登录页品牌一致性。

### 7.2 无权限页（NoAccessPage）

**路径**：`/no-access`  
**布局**：居中卡片（max-w-md），包含：
- 渐变盾形插画（120px + 同心圆环）
- 标题 + 描述
- 用户信息卡（头像 + 角色 + 数据范围）
- 双按钮：联系管理员 / 返回首页
- 底部退出登录

### 7.3 设计快照页（DesignSnapshotPage）

**路径**：`/__design/antd-style`  
**用途**：开发期对照手册，列出所有 token、组件、状态。  
**仅在 dev 模式可见**（`import.meta.env.DEV` 守卫）。

---

## 8. 文件索引

- **布局入口**：`web/src/routes.tsx` / `web/src/App.tsx`
- **侧栏组件**：`web/src/components/app-sidebar.tsx`
- **顶栏组件**：`web/src/components/app-header.tsx`
- **顶栏风格切换**：`web/src/components/sidebar-style-switcher.tsx`
- **菜单配置**：`web/src/config/menu.ts`
- **路由 meta**：`web/src/config/routes.ts`
- **CSS 主题**：`web/src/styles/globals.css`（第 167+ 行 4 套风格预设）
- **设计稿**：`antd-style-design/pages/shell-system-v1.html`
