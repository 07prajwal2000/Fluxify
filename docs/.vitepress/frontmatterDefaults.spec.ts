import { describe, expect, it } from "bun:test";
import { frontmatterDefaults } from "./frontmatterDefaults";

const SRC = "/docs";
const run = (code: string, page = "concepts/page.md") => {
	const transform = frontmatterDefaults(SRC).transform as (code: string, id: string) => unknown;
	return transform(code, `${SRC}/${page}`) as { code: string } | null;
};

describe("frontmatterDefaults", () => {
	it("leaves a page with a title and description alone", () => {
		expect(run("---\ntitle: A\ndescription: B\n---\n# A\n\nText")).toBeNull();
	});

	it("takes the title from the first h1 and the description from the text", () => {
		const out = run("# Hello World\n\nSome **bold** text with [a link](/x) and `code`.")!;
		expect(out.code).toContain('title: "Hello World"');
		expect(out.code).toContain('description: "Some bold text with a link and code."');
	});

	it("falls back to Untitled and cuts the description at 100 characters", () => {
		const out = run(`---\nlayout: doc\n---\n${"word ".repeat(50)}`)!;
		expect(out.code).toContain("layout: doc");
		expect(out.code).toContain('title: "Untitled"');
		expect(out.code).toMatch(/description: "(word ?){20}"/);
	});

	it("skips the home page, blog posts and empty pages", () => {
		expect(run("# Home", "index.md")).toBeNull();
		expect(run("# Post", "blog/posts/a.md")).toBeNull();
		expect(run("")).toBeNull();
	});
});
