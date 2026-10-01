# 壹品慧财务平台设计约定

本次沿用现有橙色主题、浅灰页面、白色卡片、中文字体及表格密度，不重新设计视觉系统。
设计依据为 `docs/plans/frontend-design-proposal.md`、`docs/references/frontend.md` 与当前运行组件。

## 布局和滚动

- 所有弹窗使用统一 Dialog 门面，标题和底部操作区不参与压缩；只有 DialogBody 滚动。
- 弹窗高度随动态视口收敛，窗口上下至少留出 16px；正文不能把提交、关闭按钮推到窗口外。
- 纯列表页使用 PageContainer 的 viewportBound，标题、筛选和分页保持可见，DataTable 的 fillHeight 消耗剩余高度。
- 表格表头只在自己的滚动容器内吸顶，并建立独立层叠上下文；冻结列和横向滚动沿用现有能力。
- 混合页面继续使用自然高度或显式 maxHeight，避免改变看板、报告和多区块页面的滚动语义。
- 分页按所在容器宽度收拢：不足 900px 时保留统计、每页条数和上一页/下一页；宽容器显示页码和跳转。
- 多行输入禁止手工拖拽放大；长内容通过弹窗正文滚动访问。

## 验证

通过组件测试检查正文边界、固定操作和链接表单提交；浏览器模拟接口检查 1440×900、1024×600、800×450、390×600。
浏览器证据位于 `web/audit/responsive-layout`，执行入口为 `web/scripts/check-responsive-layout.mjs`。
检查不连接真实业务接口，生产发布仍遵循正式 tag 部署流程。

## 组件归属

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Dialog / Modal | Ant Design Modal + Dialog 门面 | web/src/components/ui/dialog.tsx | 标准弹窗、只读详情、确认弹窗 | dialog.test.tsx、浏览器滚动检查 |
| Table Selection | DataTable / ProDataTable | web/src/components/data-table | 自然高度、maxHeight、fillHeight、虚拟表格 | data-table.test.tsx、浏览器横纵滚动 |
| Select/Listbox | Ant Design Select 门面 | web/src/components/ui/select.tsx | 单选、多选 | 原有组件测试 |
| Date | 现有统一日期控件 | web/src/components/ui | 原有日期、月份、期间控件 | 原有日期测试 |
| Form | 现有业务表单与 UI 门面 | web/src/components/ui | 原有业务校验规则 | 原有业务测试 |
| Scrollbar | 全局 CSS 与侧栏变量 | web/src/styles/globals.css | 全局、侧栏主题 | 浏览器横纵滚动 |
| Toast | 现有通知门面 | web/src/components/ui | 原有错误、成功、确认反馈 | 原有组件测试 |
| Pagination | Pagination | web/src/components/data-table/pagination.tsx | 按容器宽度收拢 | 原有分页测试、浏览器几何检查 |

静态设计审计将大写 JSX 门面识别为原生控件，相关结果需要人工核对，不作为改写既有组件归属的依据。
