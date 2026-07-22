# 性能优化规范（模块 11）

## 前端性能

- **首屏优化**：代码分割（Vite 自动）+ 懒加载路由（React.lazy + Suspense）
- **静态资源**：Vite 构建自动 gzip + 哈希指纹，nginx 配置 gzip_static
- **图片**：使用 WebP 格式 + 懒加载
- **请求优化**：TanStack Query 自动缓存 + 去重，减少重复 API 调用
- **表格优化**：ProTable 虚拟滚动（`scroll.y` + `pagination: false` 配合）
- **ECharts**：按需导入组件包，避免全量引入

## 后端性能

- **数据库连接池**：Prisma 内置连接池（默认连接数 10）
- **批量导入**：分批处理（每批 1000 行），避免大事务
- **耗时操作**：数据导入异步化（当前为同步，后续可迁移到消息队列）
- **查询优化**：Prisma 查询使用 `select` 只取需要的字段，避免 `SELECT *`
- **索引策略**：外键、高频查询字段建索引（@@index 已在 schema 中定义）
- **慢查询**：PostgreSQL `log_min_duration_statement = 1000ms` 配置（部署阶段启用）

## 缓存策略

- **当前**：无 Redis，简化架构
- **优化方向**（后续）：热点指标查询结果可缓存到内存（node-cache / lru-cache），设 5 分钟 TTL
- **指标计算**：计算类指标结果缓存，依赖数据变更时失效

## 详细参考

- Nginx 配置 → Read `nginx.conf`
- 部署优化 → Read `docs/plans/部署运维规范.md`
