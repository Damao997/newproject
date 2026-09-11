---
id: REC-20260828-003
project: kiwi-kb
type: docs
date: 2026-08-28
title: 知识库记录规范制定
owner: admin
files:
  - kiwi/README.md
  - kiwi/templates/record.md
reason: 建立记录规范
tags:
  - 规范
  - 文档
status: draft
---

# 知识库记录规范制定

## 改动内容

制定了 kiwi 知识库的记录规范，明确记录时机、命名与格式约定、frontmatter 必填字段（id/project/type/date/title/owner/files/reason）的填写要求。同时沉淀了标准记录模板 templates/record.md，后续所有记录由 `new` 命令按模板统一生成，保证章节结构与元数据格式一致。

## 影响范围

规范作用于 kiwi/records/ 下全部改动记录，覆盖所有项目与类型的记录创建、检索与校验流程。CLI 的 `new` 与 `validate` 命令以本规范为依据执行字段与命名校验，不影响 web/ 与 server/ 任何业务代码。

## 修订记录

- 2026-08-28 admin 创建记录。
