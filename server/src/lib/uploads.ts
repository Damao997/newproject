import path from 'path'

/**
 * 报告插图上传目录与对外 URL 前缀。
 * - 磁盘位置：{server 工作目录}/uploads/report-images（生产为内网 PM2 部署，随服务器磁盘持久化）
 * - 对外路径：/api/v1/uploads/report-images（app.ts 注册静态服务，uuid 文件名不可枚举）
 * 上传端点见 routes/reports.ts（POST /reports/uploads），仅落库站内相对路径，
 * 富文本净化层（lib/sanitize.ts）限定 img src 仅允许相对路径与 data: URI。
 */
export const REPORT_IMAGE_DIR = path.resolve(process.cwd(), 'uploads', 'report-images')
export const REPORT_IMAGE_PUBLIC_BASE = '/api/v1/uploads/report-images'

/** 图片 MIME → 扩展名白名单（fileFilter 与文件名生成共用，杜绝取用原始文件名后缀） */
export const REPORT_IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}
