import { afterAll, describe, expect, it } from "bun:test";
import { build } from "../src/build";
import { lintDocs } from "../src/lint/docs";
import { findUnawaited } from "../src/lint/unawaited";
import { blockSrc, cleanup, makePlugin } from "./helpers";

afterAll(cleanup);

/** the lines of a `run` body that drop an executeHandle promise */
const unawaited = (body: string, params = "{ executeHandle }") =>
	findUnawaited(
		"block.ts",
		`export default block({ async run(${params}) {\n${body}\n} });`,
	).map((line) => line - 1);

describe("build warnings", () => {
	it("warns about a block with no docs, and still builds", async () => {
		const root = await makePlugin({ "src/blocks/hello.ts": blockSrc("acme/t/hello", { docs: null }) });
		const { warnings, tarball } = await build(root);
		expect(warnings).toEqual(["acme/t/hello: no docs. The Docs tab will be empty"]);
		expect(tarball).toBe("acme-t-1.2.3.tgz");
	});

	it("warns about docs the portal panel cannot render", async () => {
		const docs = "<b>hi</b>\n\n[up](#top)\n\n![logo](x.png)\n\n## Title {#custom}\n\n::: details\nx\n:::";
		const root = await makePlugin({ "src/blocks/hello.ts": blockSrc("acme/t/hello", { docs }) });
		const { warnings } = await build(root);
		expect(warnings.map((w) => w.replace(/^acme\/t\/hello: docs /, ""))).toEqual([
			"line 1: raw HTML is not rendered",
			"line 3: in-page links go nowhere: the panel opens links in a new tab",
			"line 5: images are not rendered",
			"line 7: heading ids ({#id}) print as text",
			"line 9: ::: details is not rendered; use info, tip, warning, danger",
		]);
	});

	it("warns about a dropped executeHandle, with the file and line", async () => {
		const root = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", { body: 'executeHandle("tools");' }),
		});
		const { warnings } = await build(root);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^src\/blocks\/hello\.ts:\d+: executeHandle\(\.\.\.\) is not awaited/);
	});

	it("does not warn about executeHandle that is awaited, returned or passed on", async () => {
		const body = `
			const a = await executeHandle("tools");
			const b = executeHandle("tools");
			await b;
			const all = await Promise.all([executeHandle("tools"), executeHandle("tools", 1)]);
			const rest = await Promise.all([1, 2].map((n) => executeHandle("tools", n)));
			return { output: [a, all, rest], promise: executeHandle("tools") };`;
		const root = await makePlugin({ "src/blocks/hello.ts": blockSrc("acme/t/hello", { body }) });
		expect((await build(root)).warnings).toEqual([]);
	});
});

describe("executeHandle not awaited", () => {
	it("flags a bare call, a void call and a result used as a value", () => {
		expect(unawaited('executeHandle("a");')).toEqual([1]);
		expect(unawaited('void executeHandle("a");')).toEqual([1]);
		expect(unawaited('const r = executeHandle("a"); return { output: r.length };')).toEqual([1]);
		expect(unawaited('const r = executeHandle("a");')).toEqual([1]);
		expect(unawaited('return `x${executeHandle("a")}`;')).toEqual([1]);
		expect(unawaited('if (executeHandle("a")) {}')).toEqual([1]);
	});

	it("follows a renamed or defaulted binding", () => {
		expect(unawaited('run("a");', "{ executeHandle: run }")).toEqual([1]);
		expect(unawaited('await run("a"); run("b");', "{ executeHandle: run }")).toEqual([1]);
	});

	it("follows a destructure from the argument and a member call", () => {
		expect(unawaited('const { executeHandle: go } = args; go("a");', "args")).toEqual([1]);
		expect(unawaited('args.executeHandle("a");', "args")).toEqual([1]);
		expect(unawaited('await args.executeHandle("a");', "args")).toEqual([]);
	});

	it("passes awaited, returned and handed-on calls", () => {
		expect(unawaited('await executeHandle("a");')).toEqual([]);
		expect(unawaited('return executeHandle("a");')).toEqual([]);
		expect(unawaited('await Promise.all([executeHandle("a"), executeHandle("b")]);')).toEqual([]);
		expect(unawaited('await Promise.allSettled(xs.map((x) => executeHandle("a", x)));')).toEqual([]);
		expect(unawaited('const p = executeHandle("a"); return await p;')).toEqual([]);
		expect(unawaited('const p = executeHandle("a"); use(p);')).toEqual([]);
		expect(unawaited('executeHandle("a").catch(log);')).toEqual([]);
		expect(unawaited('const t = ok ? executeHandle("a") : null; await t;')).toEqual([]);
	});

	it("leaves executeHandle.branches alone: it is synchronous", () => {
		expect(unawaited('const b = executeHandle.branches("a"); return b;')).toEqual([]);
	});

	it("leaves a file with a syntax error to the bundler", () => {
		expect(findUnawaited("x.ts", "export default {")).toEqual([]);
	});
});

describe("docs the portal cannot render", () => {
	it("passes the markdown the panel supports", () => {
		const docs = [
			"## When to use it",
			"| A | B |\n| :-- | :-- |\n| 1 | 2 |",
			"::: tip\nUse `<b>` freely in code.\n:::",
			"[docs](https://example.com) and [page](/blocks/http#headers)",
			"```html\n<div>fenced</div>\n```",
		].join("\n\n");
		expect(lintDocs(docs)).toEqual([]);
	});
});
