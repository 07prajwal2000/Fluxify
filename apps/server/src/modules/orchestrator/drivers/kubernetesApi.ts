import { readFileSync } from "node:fs";
import { logger } from "@fluxify/common";

/**
 * Every Kubernetes API call, in one file — the counterpart of `dockerApi.ts`.
 *
 * The API server is plain HTTP and this needs a handful of paths, so it is a
 * `fetch` rather than the official client and its forty-odd packages, in a
 * process that also holds the database credentials.
 *
 * It performs actions and never chooses one. What a claim becomes is built in
 * `kubernetesSpec.ts`; this only knows how to send an object and read some back.
 */

const SERVICE_ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";
/** Who wrote a field, as the API server records it. */
export const FIELD_MANAGER = "fluxify-orchestrator";

/** The kinds the orchestrator writes or reads, and where each one lives. */
export const KINDS = {
	Deployment: { api: "apis/apps/v1", plural: "deployments" },
	Service: { api: "api/v1", plural: "services" },
	Secret: { api: "api/v1", plural: "secrets" },
	Pod: { api: "api/v1", plural: "pods" },
	// Installed by Traefik and KEDA, so possibly absent from a given cluster.
	IngressRoute: { api: "apis/traefik.io/v1alpha1", plural: "ingressroutes", optional: true },
	ScaledObject: { api: "apis/keda.sh/v1alpha1", plural: "scaledobjects", optional: true },
} as const;

export type Kind = keyof typeof KINDS;

export interface KubeObject {
	apiVersion: string;
	kind: Kind;
	metadata: {
		name: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		/** Bumped by the API server on every spec change, whoever made it. */
		generation?: number;
		deletionTimestamp?: string;
	};
	[field: string]: unknown;
}

export interface KubeEndpoint {
	base: string;
	namespace: string;
	/** Read on every request: the token a cluster mounts is rotated under us. */
	token: () => string;
	/** PEM of the CA that signed the API server's certificate, when it is not a public one. */
	ca?: string;
}

/**
 * Where the API server is and how to authenticate, from the environment when
 * `K8S_API_URL` is set, else from what Kubernetes mounts into every pod.
 */
export function kubeEndpoint(
	// process.env rather than getEnv: the in-cluster variables are Kubernetes's, not ours to declare.
	env: (key: string) => string | undefined = (key) => process.env[key],
): KubeEndpoint {
	const base = env("K8S_API_URL");
	const caPath = env("K8S_CA_CERT");
	if (base) {
		const token = env("K8S_SA_TOKEN");
		if (!token) throw new Error("K8S_API_URL is set but K8S_SA_TOKEN is not");
		return {
			base: base.replace(/\/$/, ""),
			namespace: env("K8S_NAMESPACE") || "default",
			token: () => token,
			...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
		};
	}

	const host = env("KUBERNETES_SERVICE_HOST");
	if (!host) {
		throw new Error(
			"no Kubernetes API server: set K8S_API_URL and K8S_SA_TOKEN, or run the orchestrator inside the cluster",
		);
	}
	return {
		// An IPv6 service address needs brackets to be a URL.
		base: `https://${host.includes(":") ? `[${host}]` : host}:${env("KUBERNETES_SERVICE_PORT") || "443"}`,
		namespace: env("K8S_NAMESPACE") || readFileSync(`${SERVICE_ACCOUNT}/namespace`, "utf8").trim(),
		token: () => readFileSync(`${SERVICE_ACCOUNT}/token`, "utf8").trim(),
		ca: readFileSync(caPath || `${SERVICE_ACCOUNT}/ca.crt`, "utf8"),
	};
}

export class KubeError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * An object name, rechecked at the last step before it becomes part of a URL.
 * The names are built from validated ids already, but a `/` here would reach
 * a different endpoint than the one meant.
 */
const NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export function objectPath(namespace: string, kind: Kind, name?: string) {
	if (name !== undefined && !NAME.test(name)) {
		throw new Error(`refusing a malformed ${kind} name: ${name}`);
	}
	const { api, plural } = KINDS[kind];
	return `/${api}/namespaces/${namespace}/${plural}${name ? `/${name}` : ""}`;
}

export function createKubeApi(endpoint: KubeEndpoint = kubeEndpoint()) {
	/** Kinds found missing, so a cluster without KEDA is reported once, not every pass. */
	const missing = new Set<Kind>();

	async function request(path: string, init: RequestInit = {}): Promise<Response> {
		const response = await fetch(`${endpoint.base}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${endpoint.token()}`,
				accept: "application/json",
				...init.headers,
			},
			...(endpoint.ca ? { tls: { ca: endpoint.ca } } : {}),
		});
		if (!response.ok) {
			throw new KubeError(
				response.status,
				`kubernetes ${init.method ?? "GET"} ${path} failed (${response.status}): ${await response.text()}`,
			);
		}
		return response;
	}

	/**
	 * A 404 on a kind a cluster may simply not have installed. Anything else is
	 * a real failure and is thrown.
	 */
	function notInstalled(kind: Kind, error: unknown) {
		if (!(error instanceof KubeError) || error.status !== 404) return false;
		if (!("optional" in KINDS[kind])) return false;
		if (!missing.has(kind)) {
			missing.add(kind);
			logger.warn(
				`${kind} is not installed in this cluster (${KINDS[kind].api}); skipping it`,
				"ORCHESTRATOR.kubernetes",
			);
		}
		return true;
	}

	return {
		endpoint,

		/** Whether the API server answers with these credentials. Startup check only. */
		async reachable(): Promise<boolean> {
			try {
				// Namespaced and authenticated, so a wrong token or namespace fails here
				// rather than on the first pass.
				await request(`${objectPath(endpoint.namespace, "Deployment")}?limit=1`);
				return true;
			} catch (error) {
				logger.error(`kubernetes unreachable: ${String(error)}`, "ORCHESTRATOR.kubernetes");
				return false;
			}
		},

		/** Every object of a kind matching a label selector. Empty when the kind is not installed. */
		async list(kind: Kind, labelSelector: string): Promise<KubeObject[]> {
			try {
				const path = objectPath(endpoint.namespace, kind);
				const response = await request(
					`${path}?labelSelector=${encodeURIComponent(labelSelector)}`,
				);
				return ((await response.json()) as { items: KubeObject[] }).items;
			} catch (error) {
				if (notInstalled(kind, error)) return [];
				throw error;
			}
		},

		/**
		 * Makes an object look like this, creating it if it is absent — one call,
		 * server-side apply. A field this orchestrator set before and leaves out now
		 * is removed; a field another controller owns (KEDA's replica count) is not
		 * touched. Returns the object as stored, or null when the kind is not installed.
		 */
		async apply(object: KubeObject, manager = FIELD_MANAGER): Promise<KubeObject | null> {
			const path = objectPath(endpoint.namespace, object.kind, object.metadata.name);
			try {
				const response = await request(`${path}?fieldManager=${manager}&force=true`, {
					method: "PATCH",
					// JSON is YAML, so no YAML library is needed to speak apply.
					headers: { "content-type": "application/apply-patch+yaml" },
					body: JSON.stringify(object),
				});
				return (await response.json()) as KubeObject;
			} catch (error) {
				if (notInstalled(object.kind, error)) return null;
				throw error;
			}
		},

		/** Deletes an object. Already gone is success: gone is what was asked for. */
		async remove(kind: Kind, name: string): Promise<void> {
			try {
				await request(objectPath(endpoint.namespace, kind, name), { method: "DELETE" });
			} catch (error) {
				if (error instanceof KubeError && error.status === 404) return;
				throw error;
			}
		},
	};
}

export type KubeApi = ReturnType<typeof createKubeApi>;
