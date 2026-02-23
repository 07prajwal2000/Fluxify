ALTER TABLE "blocks" ALTER COLUMN "id" SET DEFAULT '019c8c75-0d1a-7cf6-8e94-bbb595628f11';--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "id" SET DEFAULT '019c8c75-0d1b-73ad-b4fb-5dbb3a0bc9fa';--> statement-breakpoint
ALTER TABLE "project_settings" ALTER COLUMN "id" SET DEFAULT '019c8c75-0d1a-7cf6-8e94-bbb27cbda60e';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DEFAULT '019c8c75-0d19-7d1c-a0f3-864b3ff089f2';--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "id" SET DEFAULT '019c8c75-0d1a-7cf6-8e94-bbb405ccb3a1';--> statement-breakpoint
CREATE INDEX "idx_projects_id" ON "projects" USING btree ("id");