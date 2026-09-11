-- CreateTable
CREATE TABLE "formula_rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula_template" TEXT NOT NULL,
    "ref_codes" JSONB,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formula_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formula_rule_name_key" ON "formula_rule"("name");
