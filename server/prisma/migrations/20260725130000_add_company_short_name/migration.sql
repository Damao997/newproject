-- AlterTable: 为公司表添加简称字段（仅用于前端展示）
ALTER TABLE "company" ADD COLUMN "short_name" VARCHAR(100);
