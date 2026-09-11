# web/Dockerfile
# 浙江壹品慧财年经营数据分析平台 — 前端镜像（静态产物 + Nginx 反代）

# ════════════════════════════════════════════════════════
# Stage 1: builder —— Vite 构建
# ════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# 构建需要 devDependencies（vite / typescript / tailwind），故不加 --omit=dev
RUN npm ci

# 拷贝构建所需的配置与源码（.dockerignore 已排除 node_modules/dist）
COPY tsconfig*.json vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY public ./public
COPY src ./src

RUN npm run build

# ════════════════════════════════════════════════════════
# Stage 2: runner —— Nginx 提供静态文件并反代 /api/v1
# ════════════════════════════════════════════════════════
FROM nginx:1.27-alpine AS runner

RUN apk add --no-cache wget

# 站点配置由本仓库维护（覆盖镜像默认 default.conf）
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
