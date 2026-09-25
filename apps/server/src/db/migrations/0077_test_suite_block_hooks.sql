CREATE TABLE "test_suite_block_hooks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"suite_id" varchar(50) NOT NULL,
	"block_id" varchar(50) NOT NULL,
	"on_before" jsonb,
	"on_after" jsonb
);
--> statement-breakpoint
ALTER TABLE "test_suite_block_hooks" ADD CONSTRAINT "test_suite_block_hooks_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_block_hooks" ADD CONSTRAINT "test_suite_block_hooks_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_test_suite_block_hooks" ON "test_suite_block_hooks" USING btree ("suite_id","block_id");