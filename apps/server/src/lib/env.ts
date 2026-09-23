import { baseEnvSchema, createEnvValidator, validatePortString } from "@fluxify/common";
import { parseDurationMs } from "@fluxify/common/schedule";
import { z } from "zod";

export const serverEnvSchema = baseEnvSchema.extend({
	SERVER_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "SERVER_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port number for standalone admin control-plane server (1001-65535)"),

	WORKER_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "WORKER_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port number for dedicated request router worker process (1001-65535)"),

	WORKER_HEALTH_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "WORKER_HEALTH_PORT must be an integer between 1001 and 65535",
		})
		.describe(
			"Port the compiled worker's supervisor serves health/readiness on (defaults to WORKER_PORT + 1)",
		),

	INTEGRATION_TIMEOUT_POLICY_IN_SEC: z
		.string()
		.optional()
		.refine((val) => !val || (Number.isInteger(Number(val)) && Number(val) > 0), {
			message: "INTEGRATION_TIMEOUT_POLICY_IN_SEC must be a positive integer",
		})
		.describe(
			"Idle database integration timeout in seconds for compiled workers (default 450 / 7.5 minutes)",
		),

	WORKER_SCHEDULE_MAX_HORIZON: z
		.string()
		.optional()
		.refine((val) => !val || /^(\d+(\.\d+)?(ns|us|ms|s|m|h))+$/.test(val), {
			message: "WORKER_SCHEDULE_MAX_HORIZON must be a duration like 720h or 90m",
		})
		.describe("How far ahead a Trigger Workflow block may schedule a run (default 720h / 30 days)"),

	WORKER_MAX_STREAM_SIZE: z
		.string()
		.optional()
		.refine((val) => !val || (Number.isInteger(Number(val)) && Number(val) > 0), {
			message: "WORKER_MAX_STREAM_SIZE must be a positive integer",
		})
		.describe(
			"Hard cap on incoming request body size in kilobytes (default 8192 / 8 MB). Fluxify is an API server, not an upload gateway — raise it deliberately",
		),

	MAX_TRIGGERS_PER_GROUP: z
		.string()
		.optional()
		.refine((val) => !val || (Number.isInteger(Number(val)) && Number(val) > 0), {
			message: "MAX_TRIGGERS_PER_GROUP must be a positive integer",
		})
		.describe(
			"How many triggers one trigger group may hold (default 5). Raise it when workers run on machines that can poll more queues",
		),

	WORKER_PROJECT_ID: z
		.string()
		.optional()
		.describe(
			"Project this worker serves. The compiled worker watches only this project's artifacts and never connects to the database. Set to * to serve every project in the artifact bucket. Projects with a subdomain are served only on it; the rest share the base domain, where equal paths shadow each other",
		),

	LICENSE_KEY: z
		.string()
		.optional()
		.describe(
			"Enterprise license. Overrides the edition set in the admin UI and makes it read-only; unset lets the UI decide (non-commercial by default). NON_COMMERCIAL grants enterprise features for non-commercial use. Any other value must be a signed license key. Read by the admin process only; workers learn the result from it",
		),

	WORKER_MODE: z
		.enum(["route", "workflow", "both"])
		.optional()
		.describe(
			"What this worker runs: route serves HTTP routes, workflow runs background workflows, both does either. Defaults to both. One mode per project — two workers on the same project in different modes is refused at boot",
		),

	WORKER_GROUP_ID: z
		.string()
		.optional()
		.describe(
			"Trigger groups this worker runs, comma-separated. Unset runs every group. Routes and queued jobs are unaffected — only triggers are placed by group",
		),

	FLUXIFY_NODE_ID: z
		.string()
		.max(100)
		.optional()
		.describe(
			"Identity of this worker node, used as its liveness and license-slot key. Set by the orchestrator when it provisions the node; a hand-started worker generates a short random one",
		),

	FLUXIFY_CLAIM_ID: z
		.string()
		.max(50)
		.optional()
		.describe(
			"The claim this worker is a replica of, which is the key its assignment record lives under. Set by the orchestrator when it provisions the node; a hand-started worker has none and runs from its environment alone",
		),

	DOCKER_HOST: z
		.string()
		.optional()
		.describe(
			"Docker daemon endpoint for the orchestrator and the container integration tests. tcp://host:port, or unix:///var/run/docker.sock in a container. Windows named pipes are not supported — use tcp://localhost:2375 (Docker Desktop: Settings → General → expose daemon on tcp://localhost:2375)",
		),

	ORCHESTRATOR_PROVIDER: z
		.enum(["docker", "kubernetes"])
		.optional()
		.describe(
			"Which platform the orchestrator drives (default docker). Chosen, never detected: an orchestrator inside a cluster may deliberately drive a Docker host, and detection would get exactly that case wrong without saying so",
		),

	K8S_API_URL: z
		.string()
		.refine((val) => !val || z.string().url().safeParse(val).success, {
			message: "K8S_API_URL must be a URL",
		})
		.optional()
		.describe(
			"Kubernetes API server the orchestrator drives, e.g. https://127.0.0.1:6443. Unset inside a cluster: the in-cluster address and the mounted service account are used instead",
		),

	K8S_SA_TOKEN: z
		.string()
		.optional()
		.describe(
			"Bearer token for K8S_API_URL, normally a service account's. Unset inside a cluster: the mounted, auto-rotated token is read instead",
		),

	K8S_NAMESPACE: z
		.string()
		.regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
		.optional()
		.describe(
			"Namespace every worker object is created in (default: the orchestrator's own namespace inside a cluster, else `default`)",
		),

	K8S_CA_CERT: z
		.string()
		.optional()
		.describe(
			"Path to the PEM certificate that signed the API server's, for a cluster with its own CA such as k3d. Inside a cluster the mounted ca.crt is used. The certificate is always verified",
		),

	K8S_NATS_MONITORING_ENDPOINT: z
		.string()
		.optional()
		.describe(
			"host:port of NATS's HTTP monitoring (port 8222 by default), as reachable from inside the cluster. KEDA reads trigger backlogs there; unset, workflow claims scale on cpu and memory only",
		),

	ORCHESTRATOR_SCALE_CPU_PERCENT: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 1 && Number(val) <= 100),
			{
				message: "ORCHESTRATOR_SCALE_CPU_PERCENT must be an integer between 1 and 100",
			},
		)
		.describe(
			"Kubernetes: average CPU use, as a percent of a node's cpu, above which a claim adds nodes (default 65)",
		),

	ORCHESTRATOR_SCALE_MEMORY_PERCENT: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 1 && Number(val) <= 100),
			{
				message: "ORCHESTRATOR_SCALE_MEMORY_PERCENT must be an integer between 1 and 100",
			},
		)
		.describe(
			"Kubernetes: average memory use, as a percent of a node's memory, above which a claim adds nodes (default 65)",
		),

	ORCHESTRATOR_WORKER_IMAGE: z
		.string()
		.max(255)
		.optional()
		.describe(
			"The ONLY image the orchestrator will ever create a container from. This is the image allowlist: nothing a user can write reaches container create, so an image name can never arrive from a database row",
		),

	ORCHESTRATOR_NETWORK: z
		.string()
		.max(100)
		.optional()
		.describe(
			"Docker network worker containers are attached to, which must be the one Traefik and NATS are on (default fluxify_net)",
		),

	ORCHESTRATOR_HEALTH_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "ORCHESTRATOR_HEALTH_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port the orchestrator serves health/readiness on (defaults to 5800)"),

	ORCHESTRATOR_RECONCILE_INTERVAL_MS: z
		.string()
		.optional()
		.refine((val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 1000), {
			message: "ORCHESTRATOR_RECONCILE_INTERVAL_MS must be an integer of at least 1000",
		})
		.describe(
			"How often the reconciler compares what is running against what should be (default 5000). Also how often the leader renews its lease, so it must stay well under the lease TTL",
		),

	ENABLE_ORCHESTRATION: z
		.enum(["true", "false"])
		.optional()
		.describe(
			"Whether this deployment has an orchestrator, which gates the claim API, the Orchestration tab and both surfaces' endpoints. A deployment-shape flag, independent of the license: Kit is one process tree with a builtin worker and no orchestrator, so it ships false (default true)",
		),

	ORCHESTRATOR_SEED_DEFAULT_CLAIM: z
		.enum(["true", "false"])
		.optional()
		.describe(
			"Whether admin sizes the node pool and creates a catch-all `both` claim with one replica when no claim exists, so a fresh deployment serves traffic without anyone opening the UI. Set false on an instance that should only run the claims an operator wrote (default true)",
		),

	AI_API_KEY: z
		.string()
		.max(255)
		.optional()
		.describe("API key for external AI provider (max 255 characters)"),

	SYSTEM_ACCESS_KEY: z
		.string()
		.max(255)
		.optional()
		.refine((val) => !val || val.length >= 8, {
			message: "SYSTEM_ACCESS_KEY must be at least 8 characters long when provided",
		})
		.describe("Secret key for machine-to-machine system API access (min 8 characters)"),

	MASTER_ENCRYPTION_KEY: z
		.string()
		.optional()
		.refine((val) => !val || Buffer.from(val, "base64").length === 32, {
			message: "MASTER_ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key",
		})
		.describe("Base64-encoded 32-byte key for AES-256-GCM encryption"),

	SEED_USER_EMAIL: z
		.string()
		.optional()
		.refine((val) => !val || z.string().email().safeParse(val).success, {
			message: "SEED_USER_EMAIL must be a valid email address",
		})
		.describe("Default email address for initial seed admin user"),

	SEED_USER_PASSWORD: z
		.string()
		.optional()
		.refine((val) => !val || val.length >= 8, {
			message: "SEED_USER_PASSWORD must be at least 8 characters long",
		})
		.describe("Default password for initial seed admin user (minimum 8 characters)"),

	SEED_USER_NAME: z
		.string()
		.optional()
		.refine((val) => !val || val.length >= 2, {
			message: "SEED_USER_NAME must be at least 2 characters long",
		})
		.describe("Default display name for initial seed admin user (minimum 2 characters)"),

	TRUSTED_ORIGINS: z
		.string()
		.optional()
		.refine(
			(val) =>
				!val || val.split(",").every((url) => z.string().url().safeParse(url.trim()).success),
			{ message: "TRUSTED_ORIGINS must be a comma-separated list of valid URLs" },
		)
		.describe("Comma-separated list of trusted origin URLs for CORS and Better Auth"),

	SERVER_URL: z
		.string()
		.optional()
		.refine((val) => !val || z.string().url().safeParse(val).success, {
			message: "SERVER_URL must be a valid HTTP/HTTPS URL",
		})
		.describe("Public base URL of the main server process"),

	ENABLE_BUILTIN_WORKER: z
		.enum(["true", "false"])
		.optional()
		.describe("Run embedded worker inside standalone server process ('true' | 'false')"),

	HOT_RELOAD_ROUTES: z
		.enum(["true", "false"])
		.optional()
		.describe("Live reload route definitions on save ('true' | 'false')"),

	ENABLE_ADMIN: z
		.enum(["true", "false"])
		.optional()
		.describe("Enable admin control-plane API endpoints ('true' | 'false')"),

	ADMIN_RATE_LIMIT_PER_SEC: z
		.string()
		.optional()
		.describe("Admin API requests allowed per second per user (default 10, 0 disables)"),

	// Background job queue. One stream serves every kind of job, so these tune
	// the worker rather than any one feature.
	JOBS_CONCURRENCY: z
		.string()
		.optional()
		.describe("Background jobs this worker runs at once (default 5)"),

	JOBS_ACK_WAIT_MS: z
		.string()
		.optional()
		.describe("How long a job may run before it is assumed lost (default 300000)"),

	JOBS_MAX_DELIVER: z
		.string()
		.optional()
		.describe("Attempts before a failing job is dropped (default 5)"),

	JOBS_RETRY_DELAY_MS: z
		.string()
		.optional()
		.describe("Delay before a failed job is redelivered (default 10000)"),
});

// Extract keys using keyof
export type ServerEnvKey = keyof z.infer<typeof serverEnvSchema>;

const validator = createEnvValidator(serverEnvSchema, "Server");
export const validateEnv = validator.validateEnv;
export const getEnv = validator.getEnv;

export const OTLP_ENDPOINT = getEnv("OTLP_LOGS_ENDPOINT")!;
export const OTLP_AUTH_HEADER_NAME = getEnv("OTLP_AUTH_HEADER_NAME")!;
export const OTLP_AUTH_HEADER_VALUE = getEnv("OTLP_AUTH_HEADER_VALUE")!;
export const OTLP_LOGGER_ENABLED = getEnv("OTLP_LOGGER_ENABLED")!;
export const OTLP_LOGGER_LEVEL = getEnv("OTLP_LOGGER_LEVEL")!;
export const PG_URL = getEnv("PG_URL")!;
export const NATS_URL = getEnv("NATS_URL")!;
export const NATS_TOKEN = getEnv("NATS_TOKEN")!;
// true = run the API-serving worker inside this admin process (testing);
// false = admin is control-plane only, a separate worker node serves user APIs.
export const ENABLE_BUILTIN_WORKER = getEnv("ENABLE_BUILTIN_WORKER")!;
// whether node claiming exists on this deployment at all — see orchestrator/gate.ts
export const ENABLE_ORCHESTRATION = getEnv("ENABLE_ORCHESTRATION")!;
// which project's compiled artifacts this worker pulls and serves
export const WORKER_PROJECT_ID = getEnv("WORKER_PROJECT_ID")!;
/** what kind of work this worker takes on — see `jobs/subjects.ts` */
export const WORKER_MODE = getEnv("WORKER_MODE") || "both";
/**
 * The trigger groups this worker runs, empty meaning every group. A claim
 * enumerates several groups, and several nodes on one group is already fine —
 * a NATS consumer group shares the work rather than fanning it out.
 */
export const WORKER_GROUP_IDS = (getEnv("WORKER_GROUP_ID") || "")
	.split(",")
	.map((id) => id.trim())
	.filter(Boolean);
/** identity of this node; the orchestrator sets it, a hand-started worker does not */
export const FLUXIFY_NODE_ID = getEnv("FLUXIFY_NODE_ID") || undefined;
/** the claim this node belongs to, which its assignment record is keyed by (#426) */
export const FLUXIFY_CLAIM_ID = getEnv("FLUXIFY_CLAIM_ID") || undefined;

/** hard body-size ceiling for user-facing routes, in bytes (env is in KB) */
export const MAX_REQUEST_BODY_BYTES = (Number(getEnv("WORKER_MAX_STREAM_SIZE")) || 8192) * 1024;

/** furthest ahead a Trigger Workflow block may schedule a run; a bad value fails boot */
export const SCHEDULE_MAX_HORIZON_MS = parseDurationMs(
	getEnv("WORKER_SCHEDULE_MAX_HORIZON") || "720h",
);
