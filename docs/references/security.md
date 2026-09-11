# 安全加固规范（模块 10）

## 技术栈覆盖

- **Web 安全**：CORS（仅 `FRONTEND_ORIGIN`，credentials: true）+ helmet（CSP/HSTS/X-Frame-Options/X-Content-Type-Options）
- **认证安全**：JWT（access 15min + refresh 7day + 轮转 + token_blacklist 持久化）
- **密码哈希**：bcryptjs（cost >= 12）；管理员新建/重置密码的用户，首次登录**必须修改密码**（`user.must_change_password`，未改密前业务接口一律 403）
- **XSS 防护**：富文本存储前 DOMPurify + sanitize-html 净化 → 白名单标签（p/h1-h6/strong/em/ul/ol/li/table/img/a），移除 script/iframe/on*；前端展示前二次 DOMPurify 净化
- **文件上传**：multer — fileFilter 仅 .xlsx/.xls + 50MB 上限 + MIME magic number 校验 + 前端单任务限制
- **数据安全**：传输加密（生产 TLS 1.3）/ 存储无明文敏感字段

## 安全红线

- ✅ 所有接口配置 CORS 白名单，严禁 `Access-Control-Allow-Origin: *`
- ✅ 密码 bcrypt(cost >= 12) 哈希存储
- ✅ **必须配置速率限制**：登录接口 5 次/分钟（express-rate-limit），通用接口 100 次/分钟
- ✅ 文件上传限制类型与大小，存储路径与 Web 根目录隔离
- ✅ 所有用户输入经 Zod 校验与转义，防 SQL 注入（Prisma 参数化）/ XSS / 命令注入
- ✅ **严禁硬编码敏感信息**：JWT_SECRET 启动时检查，若无则抛异常中止启动（禁止回退默认值）
- ✅ 敏感操作记录审计日志（audit_log 表），detail 不记录原始金额
- ✅ 处理用户数据时，禁止在日志或错误信息中明文打印 PII

## 权限体系

- **5 个预置角色**：admin / finance_manager / department_manager / viewer / finance_analyst_it
- **8 模块 × 6 操作**：dashboard/indicators/transactions/inventory/reports/data/admin/ai × view/create/update/delete/export/import
- **scope 三优先级**：company_code → org_scope_bu → scope_value='*'（全量）
- **禁止硬编码 `if (role === 'admin')`**，统一通过 scope_value 实现全量访问
- **scope 绕过防护**：递归 CTE / AggregationService / 导出接口 / 数据浏览 / 报告分享 均须经过 scope 校验

## 依赖安全

- 第三方依赖来自 npm 官方
- 引入新依赖须说明理由并评估冲突
- 定期 `npm audit` 检查已知漏洞，交付时标注中低危及修复优先级

## 详细参考

- 完整权限矩阵、中间件代码 → Read `docs/plans/安全与权限规范.md`
- JWT / 黑名单 / scope 实现 → Read `server/src/middleware/`
