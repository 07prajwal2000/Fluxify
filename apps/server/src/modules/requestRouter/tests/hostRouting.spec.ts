import { describe, expect, it } from "bun:test";
import { applyArtifactUpdate, routeParserFor, setBaseDomain } from "../compiledRuntime";
import { isPortalOrigin, subdomainOf } from "../../../lib/hosting";

const SHOP = "0192b1c4-2222-7000-8000-00000000000a";
const BLOG = "0192b1c4-2222-7000-8000-00000000000b";

function route(projectId: string, routeId: string) {
	applyArtifactUpdate(`route.${projectId}.${routeId}`, {
		routeId,
		projectId,
		projectName: projectId,
		method: "GET",
		path: "/items",
		source: "return null;",
	});
}

function subdomain(projectId: string, value: string) {
	applyArtifactUpdate(`project-config.${projectId}.current`, {
		projectId,
		compiledAt: new Date().toISOString(),
		payload: {
			appConfig: [],
			dbIntegrations: [],
			kvIntegrations: [],
			observabilityIntegrations: [],
			aiIntegrations: [],
			queueIntegrations: [],
			projectSettings: { "settings.routing.subdomain": value },
		},
	});
}

const match = (host: string) => routeParserFor(host).getRouteId("/items", "GET")?.id ?? null;

describe("subdomainOf", () => {
	it("reads the label under the base domain, ignoring port and case", () => {
		expect(subdomainOf("Shop.Example.com:8080", "example.com")).toBe("shop");
	});

	it("treats the bare domain, an IP or any other name as no subdomain", () => {
		expect(subdomainOf("example.com", "example.com")).toBeNull();
		expect(subdomainOf("10.0.0.5", "example.com")).toBeNull();
		expect(subdomainOf("notexample.com", "example.com")).toBeNull();
		expect(subdomainOf(undefined, "example.com")).toBeNull();
	});
});

describe("routing by host", () => {
	setBaseDomain("example.com");
	subdomain(SHOP, "shop");
	subdomain(BLOG, "");
	route(SHOP, "shop-items");
	route(BLOG, "blog-items");

	it("sends a project's subdomain to that project's routes only", () => {
		expect(match("shop.example.com")).toBe("shop-items");
	});

	it("keeps a project with a subdomain off the shared domain", () => {
		expect(match("example.com")).toBe("blog-items");
		expect(match("10.0.0.5")).toBe("blog-items");
	});

	it("answers an unknown subdomain with nothing", () => {
		expect(match("nobody.example.com")).toBeNull();
	});

	it("moves routes back to the shared domain when the subdomain is cleared", () => {
		subdomain(BLOG, "blog");
		expect(match("blog.example.com")).toBe("blog-items");
		subdomain(SHOP, "");
		expect(match("shop.example.com")).toBeNull();
		expect(match("example.com")).toBe("shop-items");
	});
});

describe("isPortalOrigin", () => {
	it("trusts only localhost and 127.0.0.1 while no base domain is set", () => {
		expect(isPortalOrigin("http://localhost:3000", "")).toBe(true);
		expect(isPortalOrigin("http://127.0.0.1:8080", "")).toBe(true);
		expect(isPortalOrigin("https://example.com", "")).toBe(false);
	});

	it("trusts exactly the configured base domain, on any scheme or port", () => {
		expect(isPortalOrigin("https://example.com", "example.com")).toBe(true);
		expect(isPortalOrigin("http://example.com:8080", "example.com")).toBe(true);
		expect(isPortalOrigin("https://shop.example.com", "example.com")).toBe(false);
		expect(isPortalOrigin("http://localhost:3000", "example.com")).toBe(false);
	});

	it("also trusts TRUSTED_ORIGINS, for a portal served elsewhere", () => {
		expect(isPortalOrigin("https://admin.corp.io", "example.com", ["https://admin.corp.io"])).toBe(true);
	});

	it("rejects a missing or malformed origin", () => {
		expect(isPortalOrigin(null, "")).toBe(false);
		expect(isPortalOrigin("null", "")).toBe(false);
	});
});
