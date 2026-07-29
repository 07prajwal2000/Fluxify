import { visit } from "unist-util-visit";
type Node = any;

export function remarkDirectiveRehype() {
	return (tree: Node) => {
		visit(tree, (node: any) => {
			if (
				node.type === "textDirective" ||
				node.type === "leafDirective" ||
				node.type === "containerDirective"
			) {
				const data = node.data || (node.data = {});
				// Prefix the hName to avoid collisions with standard HTML tags
				data.hName = `ai-${node.name.toLowerCase()}`;
				data.hProperties = { ...node.attributes };
			}
		});
	};
}
