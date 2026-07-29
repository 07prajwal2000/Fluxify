import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodes, COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, $getSelection, $isRangeSelection } from "lexical";
import { useEffect } from "react";
import { $createResourceNode, ResourceNode } from "./ResourceNode";

export type InsertResourcePayload = Readonly<{
    resourceType: string;
    identifier: string;
    name: string;
    data?: string;
    replaceAt?: boolean;
}>;

export const INSERT_RESOURCE_COMMAND: LexicalCommand<InsertResourcePayload> = createCommand("INSERT_RESOURCE_COMMAND");

export function ResourcePlugin(): null {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        if (!editor.hasNodes([ResourceNode])) {
            throw new Error("ResourcePlugin: ResourceNode not registered on editor");
        }

        return editor.registerCommand<InsertResourcePayload>(
            INSERT_RESOURCE_COMMAND,
            (payload) => {
                editor.update(() => {
                    const sel = $getSelection();
                    if ($isRangeSelection(sel) && payload.replaceAt) {
                        let foundAt = false;
                        for (let i = 0; i < 60; i++) {
                            sel.modify("extend", true, "character");
                            if (sel.getTextContent().startsWith("@")) {
                                foundAt = true;
                                break;
                            }
                        }
                        if (foundAt) {
                            sel.removeText();
                        } else {
                            sel.modify("move", false, "character");
                        }
                    }
                    const resourceNode = $createResourceNode(payload.resourceType, payload.identifier, payload.name, payload.data || "");
                    $insertNodes([resourceNode]);
                });
                return true;
            },
            COMMAND_PRIORITY_EDITOR
        );
    }, [editor]);

    return null;
}
