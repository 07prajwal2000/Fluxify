ALTER TABLE "test_suites" ADD COLUMN "setup_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "teardown_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "setup_timeout_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "teardown_timeout_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "run_alone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_setup_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("setup_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_teardown_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("teardown_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE set null ON UPDATE no action;