CREATE TYPE "public"."node_reason" AS ENUM('pool_unavailable', 'no_license_slot', 'not_licensed', 'image_pull_failed', 'start_failed', 'heartbeat_stale', 'draining');--> statement-breakpoint
CREATE TYPE "public"."node_state" AS ENUM('pending', 'starting', 'ready', 'unhealthy', 'stopping', 'failed');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('route', 'workflow', 'both');--> statement-breakpoint
ALTER TYPE "public"."instance_setting_category" ADD VALUE 'orchestration';--> statement-breakpoint
CREATE TABLE "node_claims" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"type" "node_type" NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replicas" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" varchar(50),
	"claim_id" varchar(50),
	"project_id" varchar(50),
	"action" varchar(50) NOT NULL,
	"reason" "node_reason",
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_nodes" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"claim_id" varchar(50) NOT NULL,
	"replica_index" integer NOT NULL,
	"project_id" varchar(50),
	"type" "node_type" NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "node_state" DEFAULT 'pending' NOT NULL,
	"reason" "node_reason",
	"image" varchar(255),
	"container_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_claims" ADD CONSTRAINT "node_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_nodes" ADD CONSTRAINT "worker_nodes_claim_id_node_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."node_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_node_claims_project_id" ON "node_claims" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_node_claims_created_at" ON "node_claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orchestration_events_node_id" ON "orchestration_events" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_orchestration_events_created_at" ON "orchestration_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_worker_nodes_claim_replica" ON "worker_nodes" USING btree ("claim_id","replica_index");--> statement-breakpoint
CREATE INDEX "idx_worker_nodes_project_id" ON "worker_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_worker_nodes_state" ON "worker_nodes" USING btree ("state");