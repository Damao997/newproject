# 并发、幂等与分布式一致性规范（模块 7）

## 技术栈（以项目现有为准）

- **部署架构**：Docker 单机部署（单实例），当前无消息队列，无 Redis
- **数据库**：PostgreSQL 15+（事务支持）
- **ORM**：Prisma（支持事务嵌套）

## 幂等性设计

- **数据导入**：`import_batch.file_hash`（SHA256）防重复导入同一个文件
- **数据写入**：所有创建/更新操作的业务唯一键通过 Prisma `@@unique` 约束保证幂等
- **幂等键**：UUID v4 在业务入口生成，24 小时内重复请求返回已有结果

## 事务边界

- **单库操作**：优先 Prisma 本地事务（`prisma.$transaction`）
- **跨表操作**（如导入 + 审计）：使用 Prisma 交互式事务，确保原子性
- **批量导入**：分批处理（每批 1000 行），每批包裹在独立事务中，错误不回滚已提交批次

## 并发控制

- **当前限制**：单机单实例，无 Redis 分布式锁
- **乐观锁**：Prisma 更新时使用版本号或 `updatedAt` 校验避免覆盖（后续实现）
- **汇总映射环检测**：写入时 BFS/DFS 检测 + 递归 CTE 加 `depth` 计数器 + `LIMIT` 防无限递归

## 汇总聚合一致性

- AggregationService 在单个事务内完成多层汇总计算
- DAG 拓扑排序 + 环检测（metric.depends_on），发现环报错 `METRIC_CIRCULAR_REF`

## 详细参考

- 数据模型详情 → Read `docs/plans/数据模型规范.md`
- 数据库表结构 → `server/prisma/schema.prisma`
