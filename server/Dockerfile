# server/Dockerfile
# 浙江壹品慧财年经营数据分析平台 — 后端服务镜像
# 多阶段构建：builder 产出 dist + Prisma Client，runner 仅保留运行所需。

# ════════════════════════════════════════════════════════
# Stage 1: builder —— 安装全部依赖并编译
# ════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# 先拷依赖清单，利用层缓存：源码变动不触发重新 npm ci
COPY package.json package-lock.json ./
# 构建需要 devDependencies（typescript / prisma CLI），故不加 --omit=dev
RUN npm ci

# Prisma schema 需在 generate 之前就位
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ════════════════════════════════════════════════════════
# Stage 2: runner —— 运行时
# ════════════════════════════════════════════════════════
FROM node:20-alpine AS runner

# wget 供 healthcheck；openssl 为 Prisma 查询引擎依赖
RUN apk add --no-cache wget openssl

ENV NODE_ENV=production
WORKDIR /app

# ⚠️ 刻意不执行 `npm prune --omit=dev`：
#   部署流程需在本容器内执行 `npm run migrate:deploy`（prisma CLI）
#   与 `npm run prisma:seed`（tsx），二者均为 devDependency。
#   剪除后这两条运维命令会直接失败。内网单机部署下镜像体积不是约束，
#   保留完整 node_modules 以换取可运维性。
#   如需极致瘦身，应改为用 builder 阶段起一次性 migrate 容器，
#   而不是在此剪依赖。
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# prisma/ 必须随镜像发布：migrate deploy 与 seed 需读取 schema 与 migrations 目录
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./

# node:alpine 自带 uid/gid 1000 的 node 用户，直接复用，不新建；以非 root 运行
USER node

EXPOSE 3001

# 探针指向顶层 /health（不带 /api/v1 前缀，避开通用限流与鉴权）
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/src/server.js"]
