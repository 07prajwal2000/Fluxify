ALTER TABLE "blocks" ADD COLUMN "custom_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "parent_type" varchar(20) GENERATED ALWAYS AS (CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' ELSE 'route' END) STORED;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "parent_id" varchar(50) GENERATED ALWAYS AS (COALESCE(route_id, custom_block_id)) STORED;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "custom_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "parent_type" varchar(20) GENERATED ALWAYS AS (CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' ELSE 'route' END) STORED;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "parent_id" varchar(50) GENERATED ALWAYS AS (COALESCE(route_id, custom_block_id)) STORED;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocks_custom_block_id" ON "blocks" USING btree ("custom_block_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_parent" ON "blocks" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "idx_edges_custom_block_id" ON "edges" USING btree ("custom_block_id");--> statement-breakpoint
CREATE INDEX "idx_edges_parent" ON "edges" USING btree ("parent_type","parent_id");