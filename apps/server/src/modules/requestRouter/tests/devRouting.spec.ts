import { describe, expect, it } from "bun:test";
import { applyArtifactUpdate, devRequest, sandboxRequest, setBaseDomain } from "../compiledRuntime";
import { hashDevToken } from "../devToken";

const SHOP = "0192b1c4-3333-7000-8000-00000000000a";
const BLOG = "0192b1c4-3333-7000-8000-00000000000b";
const SHOP_TOKEN = "fxd_shop";
const BLOG_TOKEN = "fxd_blog";

function project(projectId: string, subdomain: string, token: string) {
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
			projectSettings: { "settings.routing.subdomain": subdomain },
			devTokenHash: hashDevToken(token),
		},
	});
}

function route(projectId: string, routeId: string) {
	applyArtifactUpdate(`route.${projectId}.${routeId}`, {
		routeId,
		projectId,
		projectName: projectId,
		method: "GET",
		path: "/items/:id",
		source: "return null;",
	});
}

/** the route id a `/_/dev` request reaches, or its refusal */
function reach(path: string, token: string | null, host = "example.com", env = "development") {
	const result = devRequest(path, host, token, env as "development");
	if (!result || result.status !== 200) return result?.status;
	return result.parser.getRouteId(result.path, "GET")?.id ?? null;
}

describe("/_/dev routing (#736)", () => {
	setBaseDomain("example.com");
	// both on the shared domain, same method and path: the token picks
	project(SHOP, "", SHOP_TOKEN);
	project(BLOG, "", BLOG_TOKEN);
	route(SHOP, "shop-items");
	route(BLOG, "blog-items");

	it("leaves every other path alone", () => {
		expect(devRequest("/items/1", "example.com", SHOP_TOKEN, "development")).toBeUndefined();
		expect(devRequest("/_/devices", "example.com", SHOP_TOKEN, "development")).toBeUndefined();
	});

	it("strips the prefix and routes to the token's project", () => {
		const result = devRequest("/_/dev/items/7", "example.com", SHOP_TOKEN, "development");
		expect(result?.status === 200 && result.path).toBe("/items/7");
		expect(reach("/_/dev/items/7", SHOP_TOKEN)).toBe("shop-items");
		expect(reach("/_/dev/items/7", BLOG_TOKEN)).toBe("blog-items");
	});

	it("refuses a missing or wrong token with 401", () => {
		expect(reach("/_/dev/items/7", null)).toBe(401);
		expect(reach("/_/dev/items/7", "fxd_wrong")).toBe(401);
	});

	it("is a 404 on a production worker, whatever the headers say", () => {
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "example.com", "production")).toBe(404);
		expect(reach("/_/dev/items/7", null, "example.com", "production")).toBe(404);
	});

	it("keeps a project subdomain to its own token", () => {
		project(SHOP, "devshop", SHOP_TOKEN);
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "devshop.example.com")).toBe("shop-items");
		expect(reach("/_/dev/items/7", BLOG_TOKEN, "devshop.example.com")).toBe(404);
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "nobody.example.com")).toBe(404);
	});

	it("answers a project with a subdomain on that subdomain only (#742)", () => {
		project(SHOP, "devshop", SHOP_TOKEN);
		// bare host, valid token: the project lives on its subdomain
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "example.com")).toBe(404);
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "10.0.0.5:3000")).toBe(404);
		expect(reach("/_/dev/items/7", SHOP_TOKEN, "devshop.example.com")).toBe("shop-items");
		// a project with no subdomain keeps working on the bare host
		expect(reach("/_/dev/items/7", BLOG_TOKEN, "example.com")).toBe("blog-items");
	});

	it("applies the same rule to a sandbox", () => {
		project(SHOP, "devshop", SHOP_TOKEN);
		applyArtifactUpdate(`sandbox.${SHOP}.sbx1`, {
			routeId: "sbx1",
			projectId: SHOP,
			projectName: "shop",
			method: "*",
			path: "/_sandbox/sbx1",
			source: "return null;",
			sandbox: true,
		});
		expect(sandboxRequest("/_sandbox/sbx1/x", SHOP_TOKEN, "example.com")).toEqual({ status: 404 });
		expect(sandboxRequest("/_sandbox/sbx1/x", SHOP_TOKEN, "devshop.example.com")?.status).toBe(200);
		// a wrong token is still a 401 before the host is looked at
		expect(sandboxRequest("/_sandbox/sbx1/x", "fxd_wrong", "example.com")).toEqual({
			status: 401,
		});
		// a project without a subdomain stays reachable on the bare host
		applyArtifactUpdate(`sandbox.${BLOG}.sbx2`, {
			routeId: "sbx2",
			projectId: BLOG,
			projectName: "blog",
			method: "*",
			path: "/_sandbox/sbx2",
			source: "return null;",
			sandbox: true,
		});
		expect(sandboxRequest("/_sandbox/sbx2/x", BLOG_TOKEN, "example.com")?.status).toBe(200);
	});

	it("answers an unknown path under the prefix with no route", () => {
		expect(reach("/_/dev/nothing", SHOP_TOKEN, "devshop.example.com")).toBeNull();
		expect(reach("/_/dev", SHOP_TOKEN, "devshop.example.com")).toBeNull();
	});
});
