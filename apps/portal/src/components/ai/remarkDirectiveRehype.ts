import { visit } from "unist-util-visit";

type Node = any;

export function remarkDirectiveRehype() {
	return (tree: Node) => {
		visit(tree, (node: any, index, parent: any) => {
			// a bare `:name` is plain prose (`09:00`, `js:expr`), not a directive —
			// real inline directives always carry a `[label]` or `{attrs}`
			if (
				node.type === "textDirective" &&
				!node.children?.length &&
				!Object.keys(node.attributes ?? {}).length &&
				parent &&
				index !== undefined
			) {
				parent.children[index] = { type: "text", value: `:${node.name}` };
				return;
			}
			if (
				node.type === "textDirective" ||
				node.type === "leafDirective" ||
				node.type === "containerDirective"
			) {
				node.data ??= {};
				const data = node.data;
				// Prefix the hName to avoid collisions with standard HTML tags
				data.hName = `ai-${node.name.toLowerCase()}`;
				data.hProperties = { ...node.attributes };
				// `:::tip[Title]` - the title arrives as a flagged first paragraph
				const label = node.children?.[0];
				if (node.type === "containerDirective" && label?.data?.directiveLabel) {
					label.data.hName = "strong";
					label.data.hProperties = { className: "fx-callout__title mb-1 block text-foreground" };
				}
			}
		});
	};
}
