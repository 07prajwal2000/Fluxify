DROP INDEX "uq_worker_nodes_claim_replica";--> statement-breakpoint
CREATE INDEX "idx_worker_nodes_claim_replica" ON "worker_nodes" USING btree ("claim_id","replica_index");