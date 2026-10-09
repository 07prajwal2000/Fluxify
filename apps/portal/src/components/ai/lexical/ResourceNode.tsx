import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode } from "lexical";
import { DecoratorNode } from "lexical";
import type React from "react";
import { AgentRef } from "../AgentRef";

export type SerializedResourceNode = SerializedLexicalNode & {
	resourceType: string;
	identifier: string;
	name: string;
};

/** A resource mention in the prompt editor; written out as `:ref[name]{type=… id=…}`. */
export class ResourceNode extends DecoratorNode<React.ReactNode> {
	__resourceType: string;
	__identifier: string;
	__name: string;

	static getType(): string {
		return "resource";
	}

	static clone(node: ResourceNode): ResourceNode {
		return new ResourceNode(node.__resourceType, node.__identifier, node.__name, node.__key);
	}

	constructor(resourceType: string, identifier: string, name: string, key?: NodeKey) {
		super(key);
		this.__resourceType = resourceType;
		this.__identifier = identifier;
		this.__name = name;
	}

	createDOM(_config: EditorConfig): HTMLElement {
		const dom = document.createElement("span");
		dom.className = "lexical-resource-node";
		return dom;
	}

	updateDOM(): boolean {
		return false;
	}

	exportJSON(): SerializedResourceNode {
		return {
			...super.exportJSON(),
			resourceType: this.__resourceType,
			identifier: this.__identifier,
			name: this.__name,
			type: "resource",
			version: 1,
		};
	}

	static importJSON(serializedNode: SerializedResourceNode): ResourceNode {
		return $createResourceNode(
			serializedNode.resourceType,
			serializedNode.identifier,
			serializedNode.name,
		);
	}

	isInline(): boolean {
		return true;
	}

	isKeyboardSelectable(): boolean {
		return true;
	}

	decorate(): React.ReactNode {
		return (
			<AgentRef type={this.__resourceType} id={this.__identifier}>
				{this.__name}
			</AgentRef>
		);
	}
}

export function $createResourceNode(
	resourceType: string,
	identifier: string,
	name: string,
): ResourceNode {
	return new ResourceNode(resourceType, identifier, name);
}

export function $isResourceNode(node: LexicalNode | null | undefined): node is ResourceNode {
	return node instanceof ResourceNode;
}

// A Lexical node class is registered exactly once, in the editor's
// `initialConfig.nodes`. Fast Refresh re-evaluates this module whenever it or
// anything it imports (AgentRef) changes, minting a *second* class that the
// mounted editor never registered — every insert then throws "Type resource in
// node ResourceNode does not match registered node ResourceNode with the same
// type" and the chip vanishes. A class is not hot-swappable, so take the full
// reload instead of the broken partial update. Dev only; stripped from builds.
if (import.meta.hot) import.meta.hot.decline();
