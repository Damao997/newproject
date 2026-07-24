-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('single', 'summary');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('operating', 'static');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "PeriodApplicableType" AS ENUM ('operating', 'static');

-- CreateEnum
CREATE TYPE "DimType" AS ENUM ('fiscal_year', 'period', 'business_unit', 'region', 'project');

-- CreateEnum
CREATE TYPE "AgingBucket" AS ENUM ('0_1M', '1_3M', '3_6M', '6_12M', '1_2Y', '2Y_PLUS');

-- CreateEnum
CREATE TYPE "CollectionMethod" AS ENUM ('phone', 'letter', 'legal');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('pending', 'collecting', 'partial', 'full', 'bad_debt');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "MetricDataType" AS ENUM ('data', 'calc', 'display');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('draft', 'active', 'archived', 'purged');

-- CreateEnum
CREATE TYPE "ImportDataType" AS ENUM ('operating', 'static', 'budget', 'transaction', 'inventory');

-- CreateEnum
CREATE TYPE "DesensitizeType" AS ENUM ('amount', 'counterparty', 'subject');

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "legal_entity" TEXT,
    "management_entity" TEXT,
    "business_unit" TEXT,
    "parent_code" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "order_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_aggregation_map" (
    "id" TEXT NOT NULL,
    "summary_company_code" TEXT NOT NULL,
    "single_company_code" TEXT NOT NULL,
    "is_internal_elimination" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_aggregation_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_subject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "level" INTEGER NOT NULL,
    "parent_code" TEXT,
    "category" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "is_leaf" BOOLEAN NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "order_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_dimension" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicable_type" "PeriodApplicableType" NOT NULL,
    "is_calculated" BOOLEAN NOT NULL DEFAULT false,
    "calculation_formula" TEXT,
    "order_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "period_dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "contact_person" TEXT,
    "contact_phone" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dim_type" "DimType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_member" (
    "id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_code" TEXT,
    "order_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dimension_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_operating" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "period_dim_code" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_operating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_static" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "period_dim_code" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_static_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_budget" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_detail" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "company_code" TEXT NOT NULL,
    "counterparty_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "opening_balance" DECIMAL(18,2) NOT NULL,
    "debit_amount" DECIMAL(18,2) NOT NULL,
    "credit_amount" DECIMAL(18,2) NOT NULL,
    "closing_balance" DECIMAL(18,2) NOT NULL,
    "raw_json" JSONB,

    CONSTRAINT "transaction_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aging_record" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "counterparty_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "bucket_code" "AgingBucket" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aging_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_plan" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "counterparty_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "overdue_amount" DECIMAL(18,2) NOT NULL,
    "planned_date" DATE NOT NULL,
    "collector_id" TEXT,
    "method" "CollectionMethod" NOT NULL,
    "expected_amount" DECIMAL(18,2),
    "actual_amount" DECIMAL(18,2),
    "status" "CollectionStatus" NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_log" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "action_time" TIMESTAMP(3) NOT NULL,
    "action_by" TEXT,
    "content" TEXT NOT NULL,
    "attachment_url" TEXT,

    CONSTRAINT "collection_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_record" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "company_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "book_amount" DECIMAL(18,2) NOT NULL,
    "raw_json" JSONB,

    CONSTRAINT "inventory_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_template" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "structure" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" TEXT NOT NULL,
    "template_id" TEXT,
    "title" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "company_scope" JSONB NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_section" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "auto_data" JSONB,
    "order_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_version" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_summary" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_comment" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "section_id" TEXT,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_share" (
    "id" TEXT NOT NULL,
    "share_token" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "created_by" TEXT,
    "expires_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "company_code" TEXT,
    "org_scope_bu" JSONB,
    "business_unit" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "refresh_token_jti" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "scope_value" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope_type" TEXT,
    "scope_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "data_type" "MetricDataType" NOT NULL,
    "formula" TEXT,
    "depends_on" JSONB,
    "source_account_codes" JSONB,
    "direction" "Direction",
    "is_derived" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "owner" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definition_history" (
    "id" TEXT NOT NULL,
    "metric_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "formula" TEXT NOT NULL,
    "description" TEXT,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,

    CONSTRAINT "metric_definition_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fiscal_year" TEXT,
    "period" TEXT,
    "status" "ImportStatus" NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "mapping_scheme_id" TEXT,
    "source_type" TEXT,
    "file_hash" TEXT,
    "data_type" "ImportDataType" NOT NULL,
    "lifecycle_status" "LifecycleStatus" NOT NULL DEFAULT 'draft',
    "errors_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_scheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT,
    "column_map" JSONB NOT NULL,
    "data_type" "ImportDataType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_id" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_desensitize_config" (
    "id" TEXT NOT NULL,
    "config_type" "DesensitizeType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "replacement" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_desensitize_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "metric_code" TEXT,
    "business_unit_code" TEXT,
    "period_code" TEXT,
    "type" TEXT,
    "threshold" DECIMAL(18,2),
    "actual_value" DECIMAL(18,2),
    "budget_value" DECIMAL(18,2),
    "level" TEXT,
    "recipient_id" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_code_key" ON "company"("code");

-- CreateIndex
CREATE INDEX "company_parent_code_idx" ON "company"("parent_code");

-- CreateIndex
CREATE INDEX "company_business_unit_idx" ON "company"("business_unit");

-- CreateIndex
CREATE INDEX "company_status_idx" ON "company"("status");

-- CreateIndex
CREATE INDEX "company_aggregation_map_single_company_code_idx" ON "company_aggregation_map"("single_company_code");

-- CreateIndex
CREATE UNIQUE INDEX "company_aggregation_map_summary_company_code_single_company_key" ON "company_aggregation_map"("summary_company_code", "single_company_code");

-- CreateIndex
CREATE UNIQUE INDEX "account_subject_code_key" ON "account_subject"("code");

-- CreateIndex
CREATE INDEX "account_subject_parent_code_idx" ON "account_subject"("parent_code");

-- CreateIndex
CREATE INDEX "account_subject_subject_type_level_idx" ON "account_subject"("subject_type", "level");

-- CreateIndex
CREATE INDEX "account_subject_status_idx" ON "account_subject"("status");

-- CreateIndex
CREATE UNIQUE INDEX "period_dimension_code_key" ON "period_dimension"("code");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_code_key" ON "counterparty"("code");

-- CreateIndex
CREATE INDEX "counterparty_company_code_idx" ON "counterparty"("company_code");

-- CreateIndex
CREATE INDEX "counterparty_status_idx" ON "counterparty"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_code_key" ON "dimension"("code");

-- CreateIndex
CREATE INDEX "dimension_member_dimension_id_idx" ON "dimension_member"("dimension_id");

-- CreateIndex
CREATE INDEX "fact_operating_batch_id_idx" ON "fact_operating"("batch_id");

-- CreateIndex
CREATE INDEX "fact_operating_account_code_period_idx" ON "fact_operating"("account_code", "period");

-- CreateIndex
CREATE UNIQUE INDEX "fact_operating_company_code_account_code_period_period_dim__key" ON "fact_operating"("company_code", "account_code", "period", "period_dim_code", "batch_id");

-- CreateIndex
CREATE INDEX "fact_static_batch_id_idx" ON "fact_static"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "fact_static_company_code_account_code_snapshot_date_period__key" ON "fact_static"("company_code", "account_code", "snapshot_date", "period_dim_code", "batch_id");

-- CreateIndex
CREATE INDEX "fact_budget_batch_id_idx" ON "fact_budget"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "fact_budget_company_code_account_code_fiscal_year_period_ba_key" ON "fact_budget"("company_code", "account_code", "fiscal_year", "period", "batch_id");

-- CreateIndex
CREATE INDEX "transaction_detail_company_code_period_idx" ON "transaction_detail"("company_code", "period");

-- CreateIndex
CREATE INDEX "transaction_detail_counterparty_code_idx" ON "transaction_detail"("counterparty_code");

-- CreateIndex
CREATE INDEX "aging_record_company_code_period_idx" ON "aging_record"("company_code", "period");

-- CreateIndex
CREATE INDEX "collection_plan_company_code_idx" ON "collection_plan"("company_code");

-- CreateIndex
CREATE INDEX "collection_plan_status_idx" ON "collection_plan"("status");

-- CreateIndex
CREATE INDEX "collection_log_plan_id_idx" ON "collection_log"("plan_id");

-- CreateIndex
CREATE INDEX "inventory_record_company_code_period_idx" ON "inventory_record"("company_code", "period");

-- CreateIndex
CREATE UNIQUE INDEX "report_template_code_key" ON "report_template"("code");

-- CreateIndex
CREATE INDEX "report_status_idx" ON "report"("status");

-- CreateIndex
CREATE INDEX "report_section_report_id_idx" ON "report_section"("report_id");

-- CreateIndex
CREATE INDEX "report_version_report_id_idx" ON "report_version"("report_id");

-- CreateIndex
CREATE INDEX "report_comment_report_id_idx" ON "report_comment"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_share_share_token_key" ON "report_share"("share_token");

-- CreateIndex
CREATE INDEX "report_share_report_id_idx" ON "report_share"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE INDEX "user_role_id_idx" ON "user"("role_id");

-- CreateIndex
CREATE INDEX "user_company_code_idx" ON "user"("company_code");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE INDEX "permission_role_id_idx" ON "permission"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "permission_role_id_resource_action_key" ON "permission"("role_id", "resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "token_blacklist_jti_key" ON "token_blacklist"("jti");

-- CreateIndex
CREATE INDEX "token_blacklist_user_id_idx" ON "token_blacklist"("user_id");

-- CreateIndex
CREATE INDEX "token_blacklist_expired_at_idx" ON "token_blacklist"("expired_at");

-- CreateIndex
CREATE UNIQUE INDEX "metric_code_key" ON "metric"("code");

-- CreateIndex
CREATE INDEX "metric_data_type_idx" ON "metric"("data_type");

-- CreateIndex
CREATE INDEX "metric_status_idx" ON "metric"("status");

-- CreateIndex
CREATE INDEX "metric_definition_history_metric_id_idx" ON "metric_definition_history"("metric_id");

-- CreateIndex
CREATE INDEX "import_batch_data_type_lifecycle_status_idx" ON "import_batch"("data_type", "lifecycle_status");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_module_action_created_at_idx" ON "audit_log"("module", "action", "created_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission" ADD CONSTRAINT "permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_blacklist" ADD CONSTRAINT "token_blacklist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
