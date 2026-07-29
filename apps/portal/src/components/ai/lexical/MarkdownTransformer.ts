import { $createParagraphNode, $createTextNode, $getRoot, LexicalEditor, $getSelection, $isRangeSelection, $createLineBreakNode } from "lexical";
import { $createResourceNode, $isResourceNode } from "./ResourceNode";

const RESOURCE_REGEX = /:resource\{type="([^"]+)" identifier="([^"]+)"(?: name="([^"]*)")?(?: data="([^"]*)")?\}/g;

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

        // Split text by newlines and create a paragraph for each line
        const lines = text.split("\n");
        
        lines.forEach((line, index) => {
            const p = index === 0 ? paragraph : $createParagraphNode();
            if (index > 0) root.append(p);

            let lastIndex = 0;
            let match;

            RESOURCE_REGEX.lastIndex = 0;

            while ((match = RESOURCE_REGEX.exec(line)) !== null) {
                const matchIndex = match.index;
                const fullMatch = match[0];
                const type = match[1];
                const identifier = match[2];
                const name = match[3] || type;
                const data = match[4] || "";

                if (matchIndex > lastIndex) {
                    const textBefore = line.slice(lastIndex, matchIndex);
                    p.append($createTextNode(textBefore));
                }

                p.append($createResourceNode(type, identifier, name, data));
                lastIndex = matchIndex + fullMatch.length;
            }

            if (lastIndex < line.length) {
                const textAfter = line.slice(lastIndex);
                p.append($createTextNode(textAfter));
            }
        });
    });
}

export function insertMarkdownAtSelection(text: string) {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;

    const nodesToInsert: any[] = [];
    const lines = text.split("\n");

    lines.forEach((line, index) => {
        let lastIndex = 0;
        let match;

        RESOURCE_REGEX.lastIndex = 0;

        while ((match = RESOURCE_REGEX.exec(line)) !== null) {
            const matchIndex = match.index;
            const fullMatch = match[0];
            const type = match[1];
            const identifier = match[2];
            const name = match[3] || type;
            const data = match[4] || "";

            if (matchIndex > lastIndex) {
                nodesToInsert.push($createTextNode(line.slice(lastIndex, matchIndex)));
            }

            nodesToInsert.push($createResourceNode(type, identifier, name, data));
            lastIndex = matchIndex + fullMatch.length;
        }

        if (lastIndex < line.length) {
            const textAfter = line.slice(lastIndex);
            nodesToInsert.push($createTextNode(textAfter));
        }

        if (index < lines.length - 1) {
            nodesToInsert.push($createLineBreakNode());
        }
    });

    if (nodesToInsert.length > 0) {
        sel.insertNodes(nodesToInsert);
    }
}

export function lexicalToMarkdown(editor: LexicalEditor): string {
    let markdown = "";
    editor.getEditorState().read(() => {
        const root = $getRoot();
        const paragraphs = (root.getChildren() as any[]);
        
        paragraphs.forEach((paragraph, index) => {
            const pChildren = paragraph.getChildren();
            let pText = "";
            pChildren.forEach((node: any) => {
                if ($isResourceNode(node)) {
                    let text = `:resource{type="${node.__resourceType}" identifier="${node.__identifier}" name="${node.__name}"`;
                    if (node.__data) {
                        text += ` data="${node.__data}"`;
                    }
                    text += `}`;
                    pText += text;
                } else {
                    pText += node.getTextContent();
                }
            });
            markdown += pText;
            if (index < paragraphs.length - 1) {
                markdown += "\n";
            }
        });
    });
    return markdown;
}
