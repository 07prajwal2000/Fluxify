import { expect, test } from "bun:test";
import { $getRoot, $getSelection, $isRangeSelection, createEditor } from "lexical";
import { REF_PATTERN, refText } from "../agentRefs";
import { lexicalToMarkdown, markdownToLexical, setEditorText } from "./MarkdownTransformer";
import { ResourceNode } from "./ResourceNode";

const editor = () => createEditor({ nodes: [ResourceNode], onError: (e) => { throw e; } });
const roundTrip = async (text: string) => {
	const e = editor();
	markdownToLexical(text, e);
	await Promise.resolve();
	return lexicalToMarkdown(e);
};

test("the editor writes the ref syntax the agent reads", async () => {
	const text = `look at ${refText("route", "r-1", "GET /users")} and\n${refText("app_config", 7, "API_KEY")}`;
	expect(text).toBe("look at :ref[GET /users]{type=route id=r-1} and\n:ref[API_KEY]{type=app_config id=7}");
	expect(await roundTrip(text)).toBe(text);
});

test("labels cannot break the syntax and odd ids are quoted", async () => {
	const text = refText("workflow", "a b", "[nightly]\njob");
	expect(text).toBe(':ref[ nightly  job]{type=workflow id="a b"}'.replace("[ ", "[").replace("  ", " "));
	expect(await roundTrip(text)).toBe(text);
});

test("every type is matched; an unknown type stays text", async () => {
	for (const t of ["route", "workflow", "trigger", "custom_block", "middleware", "integration", "app_config", "test_suite"] as const)
		expect([...refText(t, "x", "L").matchAll(REF_PATTERN)]).toHaveLength(1);
	const unknown = ":ref[Thing]{type=banana id=1}";
	expect(await roundTrip(unknown)).toBe(unknown);
});

test("setting the text puts the cursor at its end, even when it was at the start before", async () => {
	const e = editor();
	setEditorText(e, "/");
	await Promise.resolve();
	e.update(() => $getRoot().selectStart());
	await Promise.resolve();
	setEditorText(e, "/compact ");
	await Promise.resolve();
	const at = e.getEditorState().read(() => {
		const sel = $getSelection();
		return $isRangeSelection(sel) ? sel.anchor.offset : -1;
	});
	expect(at).toBe("/compact ".length);
});
