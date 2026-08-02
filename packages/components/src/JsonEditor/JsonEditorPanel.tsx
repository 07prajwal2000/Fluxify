import { Tabs } from "@heroui/react";
import { useState } from "react";
import { JsonArrayEditor } from "./JsonArrayEditor";
import { JsonObjectEditor } from "./JsonObjectEditor";
import type { JsonContainer } from "./types";
import { formatJson } from "./utils";

type EditorView = "editor" | "preview";

interface JsonEditorPanelProps {
	value: JsonContainer;
	onChange: (value: JsonContainer) => void;
	isReadOnly: boolean;
	allowExpressions: boolean;
	showPreview: boolean;
}

export function JsonEditorPanel({
	value,
	onChange,
	isReadOnly,
	allowExpressions,
	showPreview,
}: JsonEditorPanelProps) {
	const [view, setView] = useState<EditorView>("editor");

	const editor = Array.isArray(value) ? (
		<JsonArrayEditor
			allowExpressions={allowExpressions}
			depth={0}
			isReadOnly={isReadOnly}
			onChange={onChange}
			value={value}
		/>
	) : (
		<JsonObjectEditor
			allowExpressions={allowExpressions}
			depth={0}
			isReadOnly={isReadOnly}
			onChange={onChange}
			value={value}
		/>
	);

	if (!showPreview) return editor;

	return (
		<Tabs
			className="w-full"
			onSelectionChange={(key) => setView(String(key) as EditorView)}
			selectedKey={view}
			variant="secondary"
		>
			<Tabs.ListContainer>
				<Tabs.List aria-label="JSON editor views">
					<Tabs.Tab id="editor">
						Editor
						<Tabs.Indicator />
					</Tabs.Tab>
					<Tabs.Tab id="preview">
						Preview
						<Tabs.Indicator />
					</Tabs.Tab>
				</Tabs.List>
			</Tabs.ListContainer>
			<Tabs.Panel className="pt-3" id="editor">
				{editor}
			</Tabs.Panel>
			<Tabs.Panel className="pt-3" id="preview">
				<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
					{formatJson(value)}
				</pre>
			</Tabs.Panel>
		</Tabs>
	);
}

