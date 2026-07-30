import type {
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
} from "lexical";
import { DecoratorNode } from "lexical";
import React from "react";
import { ResourceChip } from "../ResourceChip";

export type SerializedResourceNode = SerializedLexicalNode & {
    resourceType: string;
    identifier: string;
    name: string;
    data: string;
};

export class ResourceNode extends DecoratorNode<React.ReactNode> {
    __resourceType: string;
    __identifier: string;
    __name: string;
    __data: string;

    static getType(): string {
        return "resource";
    }

    static clone(node: ResourceNode): ResourceNode {
        return new ResourceNode(node.__resourceType, node.__identifier, node.__name, node.__data, node.__key);
    }

    constructor(resourceType: string, identifier: string, name: string, data: string = "", key?: NodeKey) {
        super(key);
        this.__resourceType = resourceType;
        this.__identifier = identifier;
        this.__name = name;
        this.__data = data;
    }

    createDOM(config: EditorConfig): HTMLElement {
        const dom = document.createElement("span");
        dom.className = "lexical-resource-node";
        return dom;
    }

    updateDOM(prevNode: ResourceNode, dom: HTMLElement, config: EditorConfig): boolean {
        return false;
    }

    exportJSON(): SerializedResourceNode {
        return {
            ...super.exportJSON(),
            resourceType: this.__resourceType,
            identifier: this.__identifier,
            name: this.__name,
            data: this.__data,
            type: "resource",
            version: 1,
        };
    }

    static importJSON(serializedNode: SerializedResourceNode): ResourceNode {
        return $createResourceNode(serializedNode.resourceType, serializedNode.identifier, serializedNode.name, serializedNode.data);
    }

    isInline(): boolean {
        return true;
    }

    isKeyboardSelectable(): boolean {
        return true;
    }

    decorate(): React.ReactNode {
        return (
            <ResourceChip 
                type={this.__resourceType as any} 
                identifier={this.__identifier} 
                name={this.__name} 
                data={this.__data}
            />
        );
    }
}

export function $createResourceNode(resourceType: string, identifier: string, name: string, data: string = ""): ResourceNode {
    return new ResourceNode(resourceType, identifier, name, data);
}

export function $isResourceNode(node: LexicalNode | null | undefined): node is ResourceNode {
    return node instanceof ResourceNode;
}
