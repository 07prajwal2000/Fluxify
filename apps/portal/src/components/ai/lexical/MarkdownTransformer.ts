import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import { isRefType, REF_PATTERN, type RefType, refText } from "../agentRefs";
import { $createResourceNode, $isResourceNode } from "./ResourceNode";

const unquote = (v: string) => (v.startsWith('"') ? (JSON.parse(v) as string) : v);

/** One line as text and resource nodes: every `:ref[…]{…}` of a known type becomes a chip. */
function lineNodes(line: string): LexicalNode[] {
	const nodes: LexicalNode[] = [];
	let last = 0;
	for (const m of line.matchAll(REF_PATTERN)) {
		if (!isRefType(m[2])) continue;
		if (m.index > last) nodes.push($createTextNode(line.slice(last, m.index)));
		nodes.push($createResourceNode(m[2], unquote(m[3]), m[1]));
		last = m.index + m[0].length;
	}
	if (last < line.length) nodes.push($createTextNode(line.slice(last)));
	return nodes;
}

export function markdownToLexical(text: string, editor: LexicalEditor) {
	editor.update(() => {
		const root = $getRoot();
		root.clear();

		// PlainTextPlugin requires at least one paragraph node
		const paragraph = $createParagraphNode();
		root.append(paragraph);

		if (!text) {
			return;
		}

		// one paragraph per line
		text.split("\n").forEach((line, index) => {
			const p = index === 0 ? paragraph : $createParagraphNode();
			if (index > 0) root.append(p);
			p.append(...lineNodes(line));
		});
	});
}

/** Replaces the editor text and leaves the cursor at its end (a kept selection would send it to the start). */
export function setEditorText(editor: LexicalEditor, text: string) {
	markdownToLexical(text, editor);
	editor.update(() => $getRoot().selectEnd());
}

export function insertMarkdownAtSelection(text: string) {
	const sel = $getSelection();
	if (!$isRangeSelection(sel)) return;

	const nodesToInsert: LexicalNode[] = [];
	const lines = text.split("\n");
	lines.forEach((line, index) => {
		nodesToInsert.push(...lineNodes(line));
		if (index < lines.length - 1) nodesToInsert.push($createLineBreakNode());
	});

	if (nodesToInsert.length > 0) {
		sel.insertNodes(nodesToInsert);
	}
}

export function lexicalToMarkdown(editor: LexicalEditor): string {
	let markdown = "";
	editor.getEditorState().read(() => {
		const paragraphs = $getRoot().getChildren() as any[];

		paragraphs.forEach((paragraph, index) => {
			let pText = "";
			for (const node of paragraph.getChildren()) {
				pText += $isResourceNode(node)
					? refText(node.__resourceType as RefType, node.__identifier, node.__name)
					: node.getTextContent();
			}
			markdown += pText;
			if (index < paragraphs.length - 1) {
				markdown += "\n";
			}
		});
	});
	return markdown;
}
