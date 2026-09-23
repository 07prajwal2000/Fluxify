import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createKubeApi, kubeEndpoint, objectPath } from "../drivers/kubernetesApi";

const env = (values: Record<string, string>) => (key: string) => values[key];

describe("kubeEndpoint", () => {
	it("takes the API server, token and namespace from the environment", () => {
		const endpoint = kubeEndpoint(
			env({
				K8S_API_URL: "https://127.0.0.1:6443/",
				K8S_SA_TOKEN: "t0ken",
				K8S_NAMESPACE: "fluxify",
			}),
		);
		expect(endpoint.base).toBe("https://127.0.0.1:6443");
		expect(endpoint.namespace).toBe("fluxify");
		expect(endpoint.token()).toBe("t0ken");
	});

	it("defaults the namespace, and refuses an API server with no token", () => {
		expect(kubeEndpoint(env({ K8S_API_URL: "https://k", K8S_SA_TOKEN: "t" })).namespace).toBe(
			"default",
		);
		expect(() => kubeEndpoint(env({ K8S_API_URL: "https://k" }))).toThrow("K8S_SA_TOKEN");
	});

	it("says what to set when it is neither configured nor inside a cluster", () => {
		expect(() => kubeEndpoint(env({}))).toThrow("K8S_API_URL");
	});
});

describe("objectPath", () => {
	it("builds namespaced paths for core, apps and custom kinds", () => {
		expect(objectPath("ns", "Service", "svc")).toBe("/api/v1/namespaces/ns/services/svc");
		expect(objectPath("ns", "Deployment")).toBe("/apis/apps/v1/namespaces/ns/deployments");
		expect(objectPath("ns", "ScaledObject", "a")).toBe(
			"/apis/keda.sh/v1alpha1/namespaces/ns/scaledobjects/a",
		);
	});

	it("refuses a name that would reach a different endpoint", () => {
		expect(() => objectPath("ns", "Secret", "../../secrets/other")).toThrow("malformed");
		expect(() => objectPath("ns", "Secret", "a/b")).toThrow("malformed");
		expect(() => objectPath("ns", "Secret", "Upper")).toThrow("malformed");
	});
});

describe("list", () => {
	afterEach(() => {
		(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
	});

	it("puts the kind back on every item, which a list response leaves off", async () => {
		spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ kind: "DeploymentList", items: [{ metadata: { name: "a" } }] }),
		);
		const api = createKubeApi({ base: "https://k", namespace: "ns", token: () => "t" });
		const [item] = await api.list("Deployment", "x=y");
		expect(item?.kind).toBe("Deployment");
	});
});
