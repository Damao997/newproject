# FY200 移动端 App 立项与实施计划（Capacitor 混合方案）

## 一、立项概述

### 1.1 项目定位
- **项目名**：壹品慧经营分析 App（FY200 Mobile）
- **形态**：Capacitor 混合打包——现有 React Web 前端复用为 App 本体，原生壳提供启动屏/状态栏/分享/文件能力
- **目标用户**：经营层、事业部负责人、财务人员（移动办公看数场景：出差、会议、现场）
- **核心价值**：将"看板/指标/往来/报告"的**查看与分享**能力延伸到手机端，数据与 Web 同源同口径
- **范围决策（已确认）**：看数型子集；P0 内网 Wi-Fi 直连，公网访问列入后续计划
- **边界**：数据管理（Excel 导入/科目/公式/重分类）、权限管理 **不在移动端提供**，页面内提示"请在 PC 端操作"

### 1.2 范围（移动端交付模块）
| 模块 | 移动端形态 | 优先级 |
|------|-----------|:------:|
| 登录页 | 账号密码 + 记住我（复用现有登录逻辑） | P0 |
| 首页看板 | KPI 卡片 2 列网格 + 迷你趋势图 + 预警标红 + 快捷入口 | P0 |
| 财务指标 | 经营/静态双 Tab + 公司/月份筛选 + 横向滚动表格 + 科目树抽屉 + 值类型分型渲染 | P0 |
| 往来分析 | 六大往来总览 + 客商明细 + 账龄分布（只读视图） | P0 |
| 分析报告 | 报告查看 + 分享链接 + AI 润色/分析流式输出（只读+生成） | P0 |
| 预警提醒 | 看板预警卡片（后端 dashboard alerts 已就绪） | P1 |
| 导出 | Excel/PDF 经 WebView 下载 + 系统分享面板 | P1 |
| 存货管理 | 维持占位（不额外开发） | 排除 |
| 数据管理/权限管理 | 仅入口提示"请在 PC 端操作" | 排除 |

---

## 二、技术选型

### 2.1 核心栈
| 层 | 选型 | 说明 |
|----|------|------|
| 原生壳 | **Capacitor 7.x**（@capacitor/core/cli/android/ios） | 与 React 生态完全兼容，复用现有 web 构建产物 |
| UI | 现有 Radix UI + Shadcn/ui + Tailwind 3（不引入新 UI 库） | Design Token 全复用，风格与 Web 一致 |
| 路由 | 现有 react-router 7 + 新增移动端 TabBar 路由 | |
| 状态/数据 | 现有 Zustand + React Query 5 + axios（全复用） | |
| 图表 | 现有 ECharts 6（echarts-for-react） | 移动端调整容器高度与 tooltip 触控 |
| 移动端插件 | @capacitor/status-bar、@capacitor/splash-screen、@capacitor/app、@capacitor/network、@capacitor/share、@capacitor/preferences | 见 §2.2 |

### 2.2 插件职责清单
| 插件 | 用途 |
|------|------|
| @capacitor/status-bar | 沉浸式状态栏（品牌橙主题色） |
| @capacitor/splash-screen | 启动屏（logo + 品牌色） |
| @capacitor/app | 返回键处理（退出确认）、前后台生命周期（暂停 AI 流） |
| @capacitor/network | 网络状态提示（内网不可达时引导检查 Wi-Fi） |
| @capacitor/share | 导出文件系统分享（Excel/PDF） |
| @capacitor/preferences | App 内 API 地址配置存储（P0 可选，P1 认证令牌安全存储） |

### 2.3 构建与分发
- **Android**：Android SDK（API 34+）构建 APK；**企业自签名** + 内网 OTA 下载页（`version.json` + APK 链接，含版本号与更新说明）
- **iOS**：需 macOS + Xcode；内网分发走 Apple **Enterprise Program 企业签名**（若暂无企业证书，iOS 版延后至公网计划，P0 先交付 Android）
- **开发调试**：`npx cap run android` 真机运行 + Vite dev server 局域网 live reload（现有 `server.host: true` 已支持）

---

## 三、架构调整

### 3.1 前端改造（web/，无新增代码库）
1. **布局分流（核心改造点）**：[main-layout.tsx](file:///d:/flies/pj3/web/src/components/layout/main-layout.tsx)
   - 以 Tailwind `md` 断点（768px）分流：桌面保留 Sidebar+Header；移动端渲染新 `MobileTabBar`（底部固定：首页/指标/往来/报告/我的）+ 顶部品牌栏
   - 现有 `Sidebar` 已支持 `variant: 'mobile'` 抽屉，导航项配置直接复用 [nav-items.ts](file:///d:/flies/pj3/web/src/components/layout/nav-items.ts)，仅过滤出移动端可见模块
2. **表格移动化策略**：财务指标 10 列、往来明细表在窄屏改用"横向滚动容器 + 冻结首列"或卡片化列表；**移动端不启用 ProTable 虚拟滚动**（触控与性能风险），数据量控制在当前接口返回规模内
3. **筛选控件**：公司/月份/期间筛选从页头横排改为"筛选栏折叠 + 底部抽屉展开"（Radix Dialog/Drawer 复用现有组件）
4. **科目树**：桌面内联手风琴 → 移动端改为全屏抽屉（复用现有 [subject-tree](file:///d:/flies/pj3/web/src/components/subject-tree) 组件）
5. **ECharts**：统一在移动端将图表高度从 320px 降为 220px，tooltip 触发改为 `axisPointer: 'tap'`（触屏友好）
6. **导出**：复用现有 [export.ts](file:///d:/flies/pj3/web/src/lib/export.ts)/[report-export.ts](file:///d:/flies/pj3/web/src/lib/report-export.ts) 的 Blob 生成，P1 接 @capacitor/share 调起系统分享

### 3.2 API 与认证（零后端逻辑改动）
- **API 地址**：现有 `VITE_API_BASE_URL`（[api.ts](file:///d:/flies/pj3/web/src/lib/api.ts)）已支持配置；移动端打包时注入内网地址（如 `http://10.x.x.x:3001/api/v1`），P1 可在"设置"页用 @capacitor/preferences 动态配置
- **认证链路完全复用**：JWT 双 token + 单飞刷新（api.ts 已有）、zustand persist 存 localStorage（Android/iOS WebView 均持久化）；App 启动时用现有 `auth/me` 接口做静默校验
- **AI SSE 流式**：[ai-stream.ts](file:///d:/flies/pj3/web/src/lib/ai-stream.ts) 基于 fetch ReadableStream，现代 WebView 内核兼容；需真机验证 + App 切后台时 `abort()`（@capacitor/app 生命周期钩子）
- **CORS 唯一后端改动**：[cors.ts](file:///d:/flies/pj3/server/src/middleware/cors.ts) 白名单追加 `capacitor://localhost`（Android WebView origin）与 `http://localhost`（iOS）；该文件已支持逗号分隔多值，仅改 `FRONTEND_ORIGIN` 环境变量，**不改代码**

### 3.3 移动端特有工程
```
web/
├── capacitor.config.ts      # appId（com.yipinhui.mobile）、webDir='dist'、server.cleartext 允许
├── android/                 # npx cap add android 生成（纳入 git）
└── src/
    ├── components/layout/mobile-tab-bar.tsx   # 底部 TabBar
    ├── hooks/useIsMobile.ts                    # matchMedia 断点 hook
    └── lib/mobile-capacitor.ts                 # 平台能力封装（share/network/app 生命周期）
```

---

## 四、功能适配矩阵（8 大模块）

| 模块 | 移动端实现 | 复用资产 | 降级/排除项 |
|------|-----------|---------|------------|
| 登录页 | 全屏卡片表单，键盘避让 | [login/index.tsx](file:///d:/flies/pj3/web/src/pages/login/index.tsx) 已有 `max-w-[400px]` 响应式基础 | 无 |
| 首页看板 | KPI 卡片 2 列网格、迷你趋势图、预警红点 | DashboardService 接口原样复用 | 维度下钻深度限制 1 级（事业部），不再穿透到明细页 |
| 财务指标 | 双 Tab + 抽屉筛选 + 横向滚动表 | IndicatorsService 接口、值类型分型渲染、科目树组件 | 导出降级为 P1；表格冻结首列 |
| 往来分析 | 总览卡片 + 账龄分段条 + 客商明细表（横向滚动） | TransactionService 接口 | 催收计划状态流转、导入覆盖度校验仅查看 |
| 分析报告 | 报告详情页 + Tiptap 渲染（只读模式）+ AI 流式输出 | ReportService、ai-stream.ts、Tiptap | 编辑器编辑功能不做（只读展示已生成内容） |
| 数据管理 | 不提供；菜单显示"请在 PC 端操作" | — | 全排除 |
| 权限管理 | 不提供；同上 | — | 全排除 |
| 存货管理 | 维持 Web 占位现状 | — | 不开发 |

---

## 五、开发计划（P0 内网版，1 名前端全职估算）

| 里程碑 | 周期 | 内容 | 验收 |
|--------|:----:|------|------|
| **M0 移动端基座** | 1.5 周 | MobileTabBar + 布局分流 + useIsMobile + 登录页移动适配 + CORS 白名单 + 真机调试链路（vite + cap run） | 真机可登录、五 Tab 可切换 |
| **M1 看数核心** | 2.5 周 | 看板移动卡片/趋势图 + 财务指标移动表格/抽屉筛选/科目树 + 预警 | 指标/看板数据与 Web 一致性比对通过 |
| **M2 往来与报告** | 2 周 | 往来只读视图 + 报告查看 + AI 流式真机验证 + 切后台中断处理 | AI 流式在弱网真机可用 |
| **M3 打包分发** | 1.5 周 | capacitor 工程落地 + Android 签名 + 内网 OTA 下载页 + 真机矩阵回归 | 3-5 台 Android 真机核心流程通过 |
| **M4 公网演进（后续计划）** | 2-3 周 | HTTPS 证书 + 网关/WAF + iOS 企业签名或 TestFlight + 双因素认证 + 令牌安全存储 | 公网弱网可访问 |

> 合计 P0 内网版约 **7-8 周**（1 前端 + 0.5 测试兼职）。后端仅 1 处环境变量调整，无服务端开发量。

---

## 六、部署与分发

- **P0 内网**：APK 托管在内网静态目录（可与现有 nginx 同服），提供 `version.json`（版本号/更新日志/下载地址）+ 下载引导页；App 内"关于"页检测版本
- **iOS 说明**：无企业证书时 iOS 版并入 M4 公网计划（TestFlight），P0 明确只交付 Android
- **公网计划（M4）**：域名 + HTTPS 证书 → 网关反代 → CORS 白名单更新为公网域名 → WAF/限流增强 → 可选双因素（当前 JWT 体系已支持 refresh 黑名单，可直接叠加 TOTP 端点）

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Android 9+ 默认禁止明文 HTTP | 内网 HTTP API 请求失败 | `networkSecurityConfig` 或 `cleartextTraffic=true`（仅内网版；公网版走 HTTPS 后移除） |
| iOS 14+ 本地网络权限弹窗 | 首次访问内网需授权 | Info.plist 配置 `NSLocalNetworkUsageDescription` + 引导文案 |
| Android WebView 内核碎片化（SSE ReadableStream / ECharts 渲染） | 部分老设备功能异常 | 最低支持 Chrome/WebView 100+，真机矩阵（华为/小米/OPPO/vivo/荣耀 各 1 台）回归 |
| ProTable 窄屏触控与性能 | 表格滚动卡顿 | 移动端改用横向滚动容器 + 冻结首列，不启用虚拟滚动 |
| 微软雅黑字体缺失导致数字不对齐 | Android 上数字展示错位 | tailwind.config 已有 system-ui 回退链；真机验收数字列，必要时 Android 引入本地数字字体 |
| 内网 IP 变更导致 App 失联 | 无法访问 | P1 设置页支持动态配置 API 地址（@capacitor/preferences 持久化） |
| App 切后台 AI 流中断 | 报告生成半截 | @capacitor/app 生命周期钩子触发 abort + 重新进入时提示重试 |
| Web 与 App 双入口口径漂移 | 数据不一致 | 复用同一后端/同一接口，禁止 App 专用接口；验收时按模块做 Web/App 数据一致性比对 |

---

## 八、验收标准与文档沉淀

1. **功能验收**：登录/看板/指标/往来/报告五个核心流程在 Android 真机（≥5 台厂商机）+ iOS（2 台，若可用）全部通过
2. **一致性验收**：同一账号同一期间下，App 与 Web 的 KPI、指标表、往来汇总数据逐项一致
3. **性能验收**：首屏 KPI 加载 ≤ 2s（内网），表格滚动 60fps
4. **安全验收**：沿用现有权限体系（三段式 resource + scope 数据权限）在 App 端全量生效；无新增后门端点
5. **文档**：新增 `docs/plans/mobile-app-plan.md`（本计划落地版：Capacitor 工程接入步骤、签名/分发手册、真机矩阵清单）

## 九、假设

- P0 仅交付 Android APK（iOS 依赖企业证书/TestFlight，并入 M4）
- 移动端不引入任何新后端接口（预警接口若 P1 需要推送，再另行立项，涉及设备注册表新表）
- 财务指标等表格数据量维持当前接口返回规模，不做移动端分页改造