-- CreateTable
CREATE TABLE "analysis_view" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "spec" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_view_owner_id_idx" ON "analysis_view"("owner_id");
