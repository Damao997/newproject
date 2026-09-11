-- 版本快照并发保护：同一报告下版本号唯一，配合事务内递增防止并发保存产生重复版本号
CREATE UNIQUE INDEX "report_version_report_id_version_no_key" ON "report_version"("report_id", "version_no");
