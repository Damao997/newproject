-- 首次登录强制改密：管理员创建/重置密码后置 true，改密成功后置 false
ALTER TABLE "user" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
