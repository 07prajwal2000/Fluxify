CREATE TYPE "public"."access_control_roles" AS ENUM('viewer', 'creator', 'project_admin', 'system_admin');
CREATE TYPE "public"."app_config_data_types" AS ENUM('string', 'number', 'boolean');
CREATE TYPE "public"."custom_block_icon_type" AS ENUM('premade-list', 'custom');
CREATE TYPE "public"."custom_block_source_type" AS ENUM('plugin', 'inhouse', 'user-defined');
CREATE TYPE "public"."custom_block_usage" AS ENUM('flow', 'test', 'middleware');
CREATE TYPE "public"."encoding_types" AS ENUM('plaintext', 'base64', 'hex');
CREATE TYPE "public"."instance_setting_category" AS ENUM('auth', 'featureflags', 'orchestration', 'hosting');
CREATE TYPE "public"."middleware_phase" AS ENUM('before', 'after');
CREATE TYPE "public"."node_reason" AS ENUM('pool_unavailable', 'no_license_slot', 'not_licensed', 'image_pull_failed', 'start_failed', 'heartbeat_stale', 'draining');
CREATE TYPE "public"."node_state" AS ENUM('pending', 'starting', 'ready', 'unhealthy', 'stopping', 'failed');
CREATE TYPE "public"."node_type" AS ENUM('route', 'workflow', 'both');
CREATE TYPE "public"."system_log_level" AS ENUM('info', 'warn', 'error');
CREATE TYPE "public"."test_run_status" AS ENUM('queued', 'running', 'passed', 'failed', 'timeout', 'error');
CREATE TYPE "public"."agent_harness_conversation_status" AS ENUM('idle', 'running', 'paused_hitl', 'interrupted', 'completed', 'failed');
CREATE TYPE "public"."agent_harness_hitl_action_type" AS ENUM('plan_approval', 'plan_rejection', 'user_input', 'confirmation', 'cancellation', 'custom');
CREATE TYPE "public"."agent_harness_live_state_status" AS ENUM('running', 'paused_hitl', 'interrupted', 'completed', 'failed');
CREATE TYPE "public"."agent_harness_run_status" AS ENUM('queued', 'routing', 'verifying', 'planning', 'orchestrating', 'executing', 'awaiting_hitl', 'completed', 'interrupted', 'failed');
CREATE TYPE "public"."agent_harness_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'interrupted');
CREATE TABLE "access_control" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(50),
	"project_id" varchar(50),
	"role" "access_control_roles",
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "app_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_name" varchar(100),
	"description" text,
	"value" text,
	"project_id" varchar(50),
	"is_encrypted" boolean DEFAULT false,
	"encoding_type" "encoding_types",
	"data_type" "app_config_data_types" DEFAULT 'string',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "blocks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"type" varchar(100),
	"position" jsonb,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"route_id" varchar(50),
	"custom_block_id" varchar(50),
	"workflow_id" varchar(50)
);

CREATE TABLE "custom_blocks_list" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"label" varchar(50) NOT NULL,
	"description" text,
	"icon" "custom_block_icon_type",
	"icon_url" text,
	"project_id" varchar(50),
	"input_params" jsonb,
	"source_type" "custom_block_source_type" DEFAULT 'user-defined',
	"source" text DEFAULT '',
	"usage" "custom_block_usage" DEFAULT 'flow' NOT NULL,
	"docs" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "edges" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"from" varchar(50),
	"to" varchar(50),
	"from_handle" varchar(50),
	"to_handle" varchar(50),
	"route_id" varchar(50),
	"custom_block_id" varchar(50),
	"workflow_id" varchar(50)
);

CREATE TABLE "http_route_config" (
	"route_id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"route_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "instance_license" (
	"id" varchar(20) PRIMARY KEY DEFAULT 'current' NOT NULL,
	"key" text,
	"confirmed_by" varchar(50),
	"confirmed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "instance_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" "instance_setting_category" NOT NULL,
	"value" jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_key_unique" UNIQUE("key")
);

CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"group" varchar(255),
	"variant" varchar(255),
	"config" jsonb,
	"tags" varchar(255) DEFAULT '',
	"project_id" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "middleware_blocks" (
	"middleware_id" varchar(50) NOT NULL,
	"custom_block_id" varchar(50) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "middleware_blocks_middleware_id_custom_block_id_pk" PRIMARY KEY("middleware_id","custom_block_id")
);

CREATE TABLE "middlewares" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "node_claims" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"type" "node_type" NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replicas" integer DEFAULT 1 NOT NULL,
	"max_replicas" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "orchestration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" varchar(100),
	"claim_id" varchar(50),
	"project_id" varchar(50),
	"action" varchar(50) NOT NULL,
	"reason" "node_reason",
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "project_dependencies" (
	"project_id" varchar(50) PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"package_json" text NOT NULL,
	"lockfile" text NOT NULL,
	"updated_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "project_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"key" varchar(50) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "projects" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(50),
	"slug" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"hidden" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "route_middlewares" (
	"route_id" varchar(50) NOT NULL,
	"middleware_id" varchar(50) NOT NULL,
	"phase" "middleware_phase" NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "route_middlewares_route_id_middleware_id_pk" PRIMARY KEY("route_id","middleware_id")
);

CREATE TABLE "routes" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"path" text,
	"active" boolean DEFAULT false,
	"project_id" varchar(50) DEFAULT NULL,
	"method" varchar(8),
	"body_schema" jsonb,
	"query_schema" jsonb,
	"params_schema" jsonb,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"tracing_enabled" boolean DEFAULT false NOT NULL,
	"record_execution" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "system_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"level" "system_log_level" NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "test_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"status" "test_run_status" DEFAULT 'queued' NOT NULL,
	"total_suites" integer NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"duration_ms" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_runs_one_target" CHECK (num_nonnulls("test_runs"."route_id", "test_runs"."workflow_id") = 1)
);

CREATE TABLE "test_suite_block_hooks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"suite_id" varchar(50) NOT NULL,
	"block_id" varchar(50) NOT NULL,
	"on_before" jsonb,
	"on_after" jsonb
);

CREATE TABLE "test_suite_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"test_run_id" varchar(50) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"test_suite_id" varchar(50) NOT NULL,
	"status" "test_run_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"duration_ms" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_suite_runs_one_target" CHECK (num_nonnulls("test_suite_runs"."route_id", "test_suite_runs"."workflow_id") = 1)
);

CREATE TABLE "test_suites" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"input" jsonb,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"params" jsonb DEFAULT '{}'::jsonb,
	"query_params" jsonb DEFAULT '{}'::jsonb,
	"route_params" jsonb DEFAULT '{}'::jsonb,
	"content_type" varchar(100),
	"body" jsonb,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"integration_overrides" jsonb DEFAULT '[]'::jsonb,
	"app_config_overrides" jsonb DEFAULT '[]'::jsonb,
	"setup_block_id" varchar(50),
	"teardown_block_id" varchar(50),
	"setup_timeout_ms" integer DEFAULT 30000 NOT NULL,
	"teardown_timeout_ms" integer DEFAULT 30000 NOT NULL,
	"run_alone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_suites_one_target" CHECK (num_nonnulls("test_suites"."route_id", "test_suites"."workflow_id") = 1)
);

CREATE TABLE "trigger_groups" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"project_id" varchar(50) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "triggers" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"workflow_id" varchar(50),
	"group_id" varchar(50) NOT NULL,
	"integration_id" uuid,
	"batch_size" integer DEFAULT 1 NOT NULL,
	"max_wait_ms" integer DEFAULT 0 NOT NULL,
	"max_bytes" integer DEFAULT 1048576 NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"source" jsonb,
	"commit_mode" varchar(10) DEFAULT 'auto' NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_delay_ms" integer DEFAULT 1000 NOT NULL,
	"schedule" varchar(255),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "worker_nodes" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "workflows" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"description" text,
	"active" boolean DEFAULT false,
	"project_id" varchar(50) DEFAULT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"tracing_enabled" boolean DEFAULT false NOT NULL,
	"record_execution" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_artifacts" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_compactions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"summary" text NOT NULL,
	"source_run_ids" jsonb NOT NULL,
	"source_start_run_id" varchar(50) NOT NULL,
	"source_end_run_id" varchar(50) NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"source_input_tokens" integer NOT NULL,
	"source_output_tokens" integer NOT NULL,
	"compaction_input_tokens" integer NOT NULL,
	"compaction_output_tokens" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_conversations" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50),
	"project_id" varchar(50),
	"title" varchar(255) DEFAULT 'New Chat',
	"status" "agent_harness_conversation_status" DEFAULT 'idle' NOT NULL,
	"active_run_id" varchar(50),
	"pinned" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_hitl_actions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"step_id" varchar(50),
	"action_type" "agent_harness_hitl_action_type" NOT NULL,
	"user_response" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_live_states" (
	"run_id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"current_state" "agent_harness_live_state_status" DEFAULT 'running' NOT NULL,
	"active_step_id" varchar(50),
	"working_memory" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"user_query" text NOT NULL,
	"ai_response" text,
	"integration_id" uuid,
	"status" "agent_harness_run_status" DEFAULT 'queued' NOT NULL,
	"usage" jsonb,
	"interrupted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_steps" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"step_type" varchar(100) NOT NULL,
	"step_order" serial NOT NULL,
	"sub_agent_role" varchar(100),
	"sub_agent_id" varchar(100),
	"status" "agent_harness_step_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "agent_harness_sub_artifacts" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"artifact_id" varchar(50) NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"sub_agent_id" varchar(100),
	"depends_on" jsonb,
	"kind" varchar(50) NOT NULL,
	"action" varchar(50),
	"applied_at" timestamp,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);

CREATE TABLE "system_users" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"is_system_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_users_email_unique" UNIQUE("email")
);

CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);

CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "access_control" ADD CONSTRAINT "access_control_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "access_control" ADD CONSTRAINT "access_control_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "custom_blocks_list" ADD CONSTRAINT "custom_blocks_list_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edges" ADD CONSTRAINT "edges_from_blocks_id_fk" FOREIGN KEY ("from") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edges" ADD CONSTRAINT "edges_to_blocks_id_fk" FOREIGN KEY ("to") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edges" ADD CONSTRAINT "edges_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edges" ADD CONSTRAINT "edges_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edges" ADD CONSTRAINT "edges_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "http_route_config" ADD CONSTRAINT "http_route_config_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "http_route_config" ADD CONSTRAINT "http_route_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "instance_license" ADD CONSTRAINT "instance_license_confirmed_by_system_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "middleware_blocks" ADD CONSTRAINT "middleware_blocks_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "middleware_blocks" ADD CONSTRAINT "middleware_blocks_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "middlewares" ADD CONSTRAINT "middlewares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "node_claims" ADD CONSTRAINT "node_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "route_middlewares" ADD CONSTRAINT "route_middlewares_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "route_middlewares" ADD CONSTRAINT "route_middlewares_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "routes" ADD CONSTRAINT "routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_block_hooks" ADD CONSTRAINT "test_suite_block_hooks_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_block_hooks" ADD CONSTRAINT "test_suite_block_hooks_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_setup_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("setup_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_teardown_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("teardown_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "trigger_groups" ADD CONSTRAINT "trigger_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_group_id_trigger_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."trigger_groups"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "worker_nodes" ADD CONSTRAINT "worker_nodes_claim_id_node_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."node_claims"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_artifacts" ADD CONSTRAINT "agent_harness_artifacts_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_artifacts" ADD CONSTRAINT "agent_harness_artifacts_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_source_start_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("source_start_run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_source_end_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("source_end_run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_conversations" ADD CONSTRAINT "agent_harness_conversations_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_conversations" ADD CONSTRAINT "agent_harness_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_hitl_actions" ADD CONSTRAINT "agent_harness_hitl_actions_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_hitl_actions" ADD CONSTRAINT "agent_harness_hitl_actions_step_id_agent_harness_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_harness_steps"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_live_states" ADD CONSTRAINT "agent_harness_live_states_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_live_states" ADD CONSTRAINT "agent_harness_live_states_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_runs" ADD CONSTRAINT "agent_harness_runs_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_runs" ADD CONSTRAINT "agent_harness_runs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_harness_steps" ADD CONSTRAINT "agent_harness_steps_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_steps" ADD CONSTRAINT "agent_harness_steps_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_artifact_id_agent_harness_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_harness_artifacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user" ADD CONSTRAINT "user_id_system_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_access_control_user_id" ON "access_control" USING btree ("user_id");
CREATE INDEX "idx_access_control_project_id" ON "access_control" USING btree ("project_id");
CREATE INDEX "idx_app_config_key_name" ON "app_config" USING btree ("key_name");
CREATE INDEX "idx_app_config_project_id" ON "app_config" USING btree ("project_id");
CREATE INDEX "idx_app_config_is_encrypted" ON "app_config" USING btree ("is_encrypted");
CREATE INDEX "idx_app_config_encoding_type" ON "app_config" USING btree ("encoding_type");
CREATE INDEX "idx_app_config_key_name_fts" ON "app_config" USING gin (to_tsvector('english', "key_name"));
CREATE INDEX "idx_app_config_desc_fts" ON "app_config" USING gin (to_tsvector('english', coalesce("description", '')));
CREATE INDEX "idx_blocks_route_id" ON "blocks" USING btree ("route_id");
CREATE INDEX "idx_blocks_custom_block_id" ON "blocks" USING btree ("custom_block_id");
CREATE INDEX "idx_blocks_workflow_id" ON "blocks" USING btree ("workflow_id");
CREATE INDEX "idx_custom_blocks_list_project_id" ON "custom_blocks_list" USING btree ("project_id");
CREATE INDEX "idx_custom_blocks_list_name" ON "custom_blocks_list" USING btree ("name");
CREATE INDEX "idx_edges_from" ON "edges" USING btree ("from");
CREATE INDEX "idx_edges_to" ON "edges" USING btree ("to");
CREATE INDEX "idx_edges_route_id" ON "edges" USING btree ("route_id");
CREATE INDEX "idx_edges_custom_block_id" ON "edges" USING btree ("custom_block_id");
CREATE INDEX "idx_edges_workflow_id" ON "edges" USING btree ("workflow_id");
CREATE INDEX "idx_http_route_config_project_id" ON "http_route_config" USING btree ("project_id");
CREATE INDEX "idx_integrations_name" ON "integrations" USING btree ("name");
CREATE INDEX "idx_integrations_group" ON "integrations" USING btree ("group");
CREATE INDEX "idx_integrations_variant" ON "integrations" USING btree ("variant");
CREATE INDEX "idx_integrations_tags" ON "integrations" USING btree ("tags");
CREATE INDEX "idx_integrations_project_id" ON "integrations" USING btree ("project_id");
CREATE INDEX "idx_integrations_name_fts" ON "integrations" USING gin (to_tsvector('english', "name"));
CREATE INDEX "idx_integrations_meta_fts" ON "integrations" USING gin (to_tsvector('english', coalesce("group", '') || ' ' || coalesce("variant", '') || ' ' || coalesce("tags", '')));
CREATE INDEX "idx_middleware_blocks_custom_block_id" ON "middleware_blocks" USING btree ("custom_block_id");
CREATE UNIQUE INDEX "uq_middlewares_project_name" ON "middlewares" USING btree ("project_id","name");
CREATE INDEX "idx_node_claims_project_id" ON "node_claims" USING btree ("project_id");
CREATE INDEX "idx_node_claims_created_at" ON "node_claims" USING btree ("created_at");
CREATE INDEX "idx_orchestration_events_node_id" ON "orchestration_events" USING btree ("node_id");
CREATE INDEX "idx_orchestration_events_created_at" ON "orchestration_events" USING btree ("created_at");
CREATE INDEX "idx_project_settings_project_id" ON "project_settings" USING btree ("project_id");
CREATE INDEX "idx_project_settings_key" ON "project_settings" USING btree ("key");
CREATE UNIQUE INDEX "uq_project_settings_subdomain" ON "project_settings" USING btree ("value") WHERE "project_settings"."key" = 'settings.routing.subdomain' and "project_settings"."value" <> '';
CREATE INDEX "idx_projects_id" ON "projects" USING btree ("id");
CREATE INDEX "idx_projects_name" ON "projects" USING btree ("name");
CREATE UNIQUE INDEX "uq_projects_slug" ON "projects" USING btree ("slug");
CREATE INDEX "idx_projects_updated_at" ON "projects" USING btree ("updated_at");
CREATE INDEX "idx_route_middlewares_middleware_id" ON "route_middlewares" USING btree ("middleware_id");
CREATE INDEX "idx_routes_project_id" ON "routes" USING btree ("project_id");
CREATE INDEX "idx_routes_path" ON "routes" USING btree ("path");
CREATE INDEX "idx_routes_name_fts" ON "routes" USING gin (to_tsvector('english', "name"));
CREATE INDEX "idx_routes_path_fts" ON "routes" USING gin (to_tsvector('english', translate(coalesce("path", ''), '/:-_', '    ')));
CREATE UNIQUE INDEX "uq_system_logs_resource" ON "system_logs" USING btree ("type","resource_id","resource_type");
CREATE INDEX "idx_system_logs_project_id" ON "system_logs" USING btree ("project_id","updated_at");
CREATE INDEX "idx_test_runs_project_route" ON "test_runs" USING btree ("project_id","route_id","created_at");
CREATE INDEX "idx_test_runs_project_workflow" ON "test_runs" USING btree ("project_id","workflow_id","created_at");
CREATE UNIQUE INDEX "uq_test_suite_block_hooks" ON "test_suite_block_hooks" USING btree ("suite_id","block_id");
CREATE INDEX "idx_test_suite_runs_run" ON "test_suite_runs" USING btree ("test_run_id");
CREATE INDEX "idx_test_suite_runs_project" ON "test_suite_runs" USING btree ("project_id","created_at");
CREATE INDEX "idx_test_suites_workflow" ON "test_suites" USING btree ("workflow_id");
CREATE INDEX "idx_trigger_groups_project_id" ON "trigger_groups" USING btree ("project_id");
CREATE UNIQUE INDEX "uq_trigger_groups_project_name" ON "trigger_groups" USING btree ("project_id","name");
CREATE INDEX "idx_triggers_project_id" ON "triggers" USING btree ("project_id");
CREATE INDEX "idx_triggers_workflow_id" ON "triggers" USING btree ("workflow_id");
CREATE INDEX "idx_triggers_group_id" ON "triggers" USING btree ("group_id");
CREATE INDEX "idx_triggers_integration_id" ON "triggers" USING btree ("integration_id");
CREATE INDEX "idx_worker_nodes_claim_replica" ON "worker_nodes" USING btree ("claim_id","replica_index");
CREATE INDEX "idx_worker_nodes_project_id" ON "worker_nodes" USING btree ("project_id");
CREATE INDEX "idx_worker_nodes_state" ON "worker_nodes" USING btree ("state");
CREATE INDEX "idx_workflows_project_id" ON "workflows" USING btree ("project_id");
CREATE INDEX "idx_workflows_name_fts" ON "workflows" USING gin (to_tsvector('english', "name"));
CREATE INDEX "idx_harness_artifacts_conv_id" ON "agent_harness_artifacts" USING btree ("conversation_id");
CREATE INDEX "idx_harness_artifacts_run_id" ON "agent_harness_artifacts" USING btree ("run_id");
CREATE UNIQUE INDEX "uq_harness_compactions_conv_source_end" ON "agent_harness_compactions" USING btree ("conversation_id","source_end_run_id");
CREATE INDEX "idx_harness_compactions_conv_created" ON "agent_harness_compactions" USING btree ("conversation_id","created_at");
CREATE INDEX "idx_harness_conv_user_id" ON "agent_harness_conversations" USING btree ("user_id");
CREATE INDEX "idx_harness_conv_project_id" ON "agent_harness_conversations" USING btree ("project_id");
CREATE INDEX "idx_harness_conv_user_archived_pinned" ON "agent_harness_conversations" USING btree ("user_id","archived","pinned");
CREATE INDEX "idx_harness_hitl_run_id" ON "agent_harness_hitl_actions" USING btree ("run_id");
CREATE INDEX "idx_harness_hitl_step_id" ON "agent_harness_hitl_actions" USING btree ("step_id");
CREATE INDEX "idx_harness_live_conv_id" ON "agent_harness_live_states" USING btree ("conversation_id");
CREATE INDEX "idx_harness_runs_conv_id" ON "agent_harness_runs" USING btree ("conversation_id");
CREATE INDEX "idx_harness_runs_status" ON "agent_harness_runs" USING btree ("status");
CREATE INDEX "idx_harness_runs_integration_id" ON "agent_harness_runs" USING btree ("integration_id");
CREATE INDEX "idx_harness_steps_run_id" ON "agent_harness_steps" USING btree ("run_id");
CREATE INDEX "idx_harness_steps_sub_agent_id" ON "agent_harness_steps" USING btree ("sub_agent_id");
CREATE UNIQUE INDEX "uq_harness_steps_run_sub_agent" ON "agent_harness_steps" USING btree ("run_id","sub_agent_id");
CREATE INDEX "idx_harness_sub_artifacts_artifact_id" ON "agent_harness_sub_artifacts" USING btree ("artifact_id");
CREATE INDEX "idx_harness_sub_artifacts_run_id" ON "agent_harness_sub_artifacts" USING btree ("run_id");
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
