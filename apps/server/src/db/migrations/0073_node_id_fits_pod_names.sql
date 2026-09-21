ALTER TABLE "orchestration_events" ALTER COLUMN "node_id" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "worker_nodes" ALTER COLUMN "id" SET DATA TYPE varchar(100);