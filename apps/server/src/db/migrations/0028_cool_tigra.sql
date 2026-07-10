ALTER TYPE "public"."custom_block_source_type" ADD VALUE 'user-defined';--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ALTER COLUMN "source_type" SET DEFAULT 'user-defined';