import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adminCall, callTool, type McpStack, startMcpStack, stopMcpStack } from "../src/mcp";

// Custom knowledge base (#800): sources saved through the admin API, fetched
// with app config headers, and searched by the docs tools of the same project.
const SECRET = "kb-e2e-token";
let stack: McpStack;
let otherOriginGotToken: string | null | undefined;

const docs = Bun.serve({
	port: 0,
	fetch(req) {
		const { pathname } = new URL(req.url);
		const md = (body: string) => new Response(body, { headers: { "content-type": "text/markdown" } });
		if (pathname === "/llms.txt")
			return md(`# Shop\n\n- [Refunds](/refunds.md): money back\n- [Elsewhere](${other.url}away.md)\n`);
		if (pathname === "/refunds.md") return md("# Refunds\n\n## Window\n\nRefunds take 14 days.");
		if (pathname === "/llms-full.txt")
			return md("# Shipping\n\nParcels ship daily.\n\n# Returns\n\nReturn labels come from the quokka desk.");
		if (req.headers.get("x-token") !== SECRET) return new Response("no", { status: 401 });
		return new Response(
			"<html><body><h1>Pricing</h1><script>x()</script><h2>Plans</h2><p>The <b>zebra plan</b> costs 9 euros.</p></body></html>",
			{ headers: { "content-type": "text/html; charset=utf-8" } },
		);
	},
});
const other = Bun.serve({
	port: 0,
	fetch(req) {
		otherOriginGotToken = req.headers.get("x-token");
		return new Response("# Away\n\nOther origin page.");
	},
});

const base = () => `/v1/${stack.projectId}/knowledge-sources`;
const create = (body: object) =>
	adminCall(stack, stack.tokens.creator, { method: "POST", path: base(), body });
const get = async (id: string) =>
	(await adminCall(stack, stack.tokens.viewer, { path: `${base()}/${id}` })).body;
const search = (q: string, args: object = { projectId: stack.projectId }, token = stack.tokens.viewer) =>
	callTool(stack, token, "search_docs", { queries: [q], ...args });

/** The gateway reloads on a NATS event; wait for it to land. */
async function eventually(fn: () => Promise<boolean>) {
	for (let i = 0; i < 50; i++) {
		if (await fn()) return;
		await Bun.sleep(100);
	}
	throw new Error("never happened");
}

beforeAll(async () => {
	stack = await startMcpStack();
	const res = await adminCall(stack, stack.tokens.creator, {
		method: "POST",
		path: `/v1/${stack.projectId}/app-config`,
		body: {
			keyName: "DOCS_TOKEN",
			description: "",
			value: SECRET,
			isEncrypted: true,
			encodingType: "plaintext",
		},
	});
	expect(res.status).toBe(200);
}, 300_000);

afterAll(async () => {
	await stopMcpStack();
	docs.stop(true);
	other.stop(true);
});

describe("custom knowledge base", () => {
	let pricingId: string;

	it("fetches an HTML URL with an app config header and converts it", async () => {
		// the app config change reaches the admin cache over NATS too
		await eventually(async () => {
			const { status, body } = await create({
				name: "pricing",
				type: "url",
				url: `${docs.url}pricing`,
				headers: { "x-token": "DOCS_TOKEN" },
			});
			if (status !== 200) throw new Error(JSON.stringify(body));
			const src = await get(body.id);
			if (src.lastFetchStatus === "ok") pricingId = body.id;
			else await adminCall(stack, stack.tokens.creator, { method: "DELETE", path: `${base()}/${body.id}` });
			return src.lastFetchStatus === "ok";
		});
		const src = await get(pricingId);
		expect(src.pages[0].markdown).toContain("## Plans");
		expect(src.pages[0].markdown).toContain("**zebra plan**");
		expect(src.pages[0].markdown).not.toContain("x()");
		expect(src.headers).toEqual({ "x-token": "DOCS_TOKEN" });
		expect(JSON.stringify(src)).not.toContain(SECRET);
	});

	it("is searched by the docs tools of that project only", async () => {
		await eventually(async () => (await search("zebra")).text.includes("kb/pricing/pricing"));
		expect((await search("zebra", {})).text).not.toContain("kb/pricing");
		const read = await callTool(stack, stack.tokens.viewer, "read_doc", {
			page: "kb/pricing/pricing",
			projectId: stack.projectId,
		});
		expect(read.text).toContain("Plans");
		const outsider = await search("zebra", { projectId: stack.projectId }, stack.tokens.other);
		expect(outsider.ok).toBe(false);
	});

	it("refetches idempotently", async () => {
		const { status } = await adminCall(stack, stack.tokens.creator, {
			method: "POST",
			path: `${base()}/${pricingId}/refetch`,
		});
		expect(status).toBe(200);
		await Bun.sleep(500);
		const hits = (await search("zebra")).text.match(/page: kb\/pricing\/pricing \| Pricing > Plans/g);
		expect(hits?.length).toBe(1);
	});

	it("rejects an oversized page body", async () => {
		const { status } = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `${base()}/${pricingId}/pages/0`,
			body: { markdown: "x".repeat(1_000_001) },
		});
		expect(status).toBe(400);
	});

	it("rejects page editing by a viewer with 403", async () => {
		const { status } = await adminCall(stack, stack.tokens.viewer, {
			method: "PUT",
			path: `${base()}/${pricingId}/pages/0`,
			body: { markdown: "# Viewer attempt" },
		});
		expect(status).toBe(403);
	});

	it("returns 404 for an invalid page index", async () => {
		const { status } = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `${base()}/${pricingId}/pages/999`,
			body: { markdown: "# Bad index" },
		});
		expect(status).toBe(404);
	});

	it("edits a fetched page and updates search_docs, clearing the edit on refetch", async () => {
		const { status } = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `${base()}/${pricingId}/pages/0`,
			body: { markdown: "# Pricing\n\n## Custom Plans\n\nThe giraffe plan costs 15 euros." },
		});
		expect(status).toBe(200);

		const src = await get(pricingId);
		expect(src.pages[0].edited).toBe(true);
		expect(src.pages[0].markdown).toContain("giraffe plan");
		expect(src.pages[0].markdown).not.toContain("zebra plan");

		await eventually(async () => {
			const text = (await search("giraffe plan")).text;
			return text.includes("giraffe plan") && !text.includes("zebra plan");
		});

		const refetchRes = await adminCall(stack, stack.tokens.creator, {
			method: "POST",
			path: `${base()}/${pricingId}/refetch`,
		});
		expect(refetchRes.status).toBe(200);

		const srcAfter = await get(pricingId);
		expect(Boolean(srcAfter.pages[0].edited)).toBe(false);
		expect(srcAfter.pages[0].markdown).toContain("zebra plan");
		expect(srcAfter.pages[0].markdown).not.toContain("giraffe plan");

		await eventually(async () => {
			const text = (await search("zebra")).text;
			return text.includes("zebra plan") && !text.includes("giraffe plan");
		});
	});

	it("records a failed fetch instead of failing the save", async () => {
		const { body } = await create({
			name: "broken",
			type: "url",
			url: `${docs.url}pricing`,
			headers: { "x-token": "NO_SUCH_KEY" },
		});
		const src = await get(body.id);
		expect(src.lastFetchStatus).toBe("error");
		expect(src.lastFetchError).toContain("NO_SUCH_KEY");
	});

	it("previews an llms.txt and indexes the picked pages", async () => {
		const preview = await adminCall(stack, stack.tokens.creator, {
			method: "POST",
			path: `${base()}/llms-txt/preview`,
			body: { url: `${docs.url}llms.txt` },
		});
		expect(preview.body.pages).toEqual([
			{ title: "Refunds", url: `${docs.url}refunds.md` },
			{ title: "Elsewhere", url: `${other.url}away.md` },
		]);
		const { body } = await create({
			name: "shop",
			type: "llms_txt",
			url: `${docs.url}llms.txt`,
			headers: { "x-token": "DOCS_TOKEN" },
			selectedPages: preview.body.pages.map((p: { url: string }) => p.url),
		});
		expect((await get(body.id)).pageCount).toBe(2);
		// credentials stay on the llms.txt's own origin
		expect(otherOriginGotToken).toBeNull();
		await eventually(async () => (await search("refunds window")).text.includes("kb/shop/refunds"));
	});

	it("splits an llms-full.txt into pages", async () => {
		const { body } = await create({ name: "full", type: "llms_full_txt", url: `${docs.url}llms-full.txt` });
		expect((await get(body.id)).pageCount).toBe(2);
		await eventually(async () => (await search("quokka desk")).text.includes("kb/full/2"));
	});

	it("drops a deleted source from search", async () => {
		await adminCall(stack, stack.tokens.creator, { method: "DELETE", path: `${base()}/${pricingId}` });
		await eventually(async () => !(await search("zebra")).text.includes("kb/pricing"));
	});
});
