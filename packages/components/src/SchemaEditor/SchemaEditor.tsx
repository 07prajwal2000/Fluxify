import { Tabs } from "@heroui/react";
import clsx from "clsx";
import { forwardRef, useImperativeHandle, useState } from "react";
import { IoLogoJavascript } from "react-icons/io5";
import { TbEye, TbLayoutDashboard } from "react-icons/tb";
import { JavaScriptTextArea } from "../JavaScriptTextArea";
import { ConfigurationDrawer } from "./ConfigurationDrawer";
import { DEFAULT_JS } from "./constants";
import { SchemaEditorProvider, useSchemaEditorContext } from "./context";
import { InfoNote } from "./InfoNote";
import { SchemaNavigator } from "./SchemaNavigator";
import { SchemaPreview } from "./SchemaPreview";
import type { SchemaEditorProps, SchemaEditorRef } from "./types";

type TabKey = "editor" | "js" | "preview";

const SchemaEditorContent = forwardRef<
	SchemaEditorRef,
	{
		onSave?: SchemaEditorProps["onSave"];
		showPreview: boolean;
		showRootTypeSelector: boolean;
	}
>(({ onSave, showPreview, showRootTypeSelector }, ref) => {
	const { schema, setSchema, isReadOnly, disableJs, jsEditorRows } =
		useSchemaEditorContext();

	const isRootJs = schema.dataType === "js";
	const [selectedTab, setSelectedTab] = useState<TabKey>(
		isRootJs ? "js" : "editor",
	);

	useImperativeHandle(ref, () => ({
		save: () => onSave?.(schema),
		getSchema: () => schema,
	}));

	/**
	 * The tab *is* the root's type: "Custom JS" means `dataType: "js"`, which is
	 * what makes the server run the validator instead of building a shape. A
	 * read-only editor still browses both, it just does not rewrite the schema.
	 */
	const handleTabChange = (next: TabKey) => {
		setSelectedTab(next);
		if (isReadOnly) return;
		if (next === "js" && !isRootJs) {
			setSchema({ ...schema, dataType: "js", js: schema.js ?? DEFAULT_JS });
		} else if (next === "editor" && isRootJs) {
			setSchema({ ...schema, dataType: "object" });
		}
	};

	return (
		<Tabs
			onSelectionChange={(key) => handleTabChange(key as TabKey)}
			selectedKey={selectedTab}
			variant="secondary"
		>
			<Tabs.ListContainer>
				<Tabs.List aria-label="Schema editor mode">
					<Tabs.Tab id="editor">
						<TbLayoutDashboard aria-hidden className="mr-1.5 size-4" />
						Schema editor
						<Tabs.Indicator />
					</Tabs.Tab>
					{!disableJs && (
						<Tabs.Tab id="js">
							<IoLogoJavascript aria-hidden className="mr-1.5 size-4" />
							Custom JS
							<Tabs.Indicator />
						</Tabs.Tab>
					)}
					{showPreview && !isRootJs && (
						<Tabs.Tab id="preview">
							<TbEye aria-hidden className="mr-1.5 size-4" />
							Preview
							<Tabs.Indicator />
						</Tabs.Tab>
					)}
				</Tabs.List>
			</Tabs.ListContainer>

			<Tabs.Panel className="pt-4" id="editor">
				<div className="rounded-[var(--radius)] border border-border p-4">
					<SchemaNavigator showRootTypeSelector={showRootTypeSelector} />
				</div>
				<ConfigurationDrawer />
			</Tabs.Panel>

			{!disableJs && (
				<Tabs.Panel className="pt-4" id="js">
					<div className="flex flex-col gap-3 rounded-[var(--radius)] border border-border p-4">
						<InfoNote>
							Validate the entire request in JavaScript. Return a boolean to
							pass or fail. To return a custom error body, throw:{" "}
							<code className="font-mono">
								{'throw new ValidationError({ your: "error" })'}
							</code>
							.
						</InfoNote>
						<JavaScriptTextArea
							aria-label="Root custom JavaScript validation"
							onChange={(next) => setSchema({ ...schema, js: next })}
							readOnly={isReadOnly}
							rows={jsEditorRows + 8}
							value={schema.js ?? DEFAULT_JS}
						/>
					</div>
				</Tabs.Panel>
			)}

			{showPreview && !isRootJs && (
				<Tabs.Panel className="pt-4" id="preview">
					<div className="rounded-[var(--radius)] border border-border p-4">
						<SchemaPreview schema={schema} />
					</div>
				</Tabs.Panel>
			)}
		</Tabs>
	);
});

SchemaEditorContent.displayName = "SchemaEditorContent";

/**
 * Low-code builder for the validation schema the server compiles to Zod. Works
 * controlled (`value` + `onChange`) or uncontrolled (`defaultValue` + a `ref`).
 */
export const SchemaEditor = forwardRef<SchemaEditorRef, SchemaEditorProps>(
	function SchemaEditor(props, ref) {
		const {
			onSave,
			label,
			description,
			className,
			showPreview = true,
			showRootTypeSelector = true,
		} = props;

		return (
			<div className={clsx("flex w-full flex-col gap-3", className)}>
				{label && (
					<span className="text-sm font-medium text-foreground">{label}</span>
				)}
				{description && <p className="text-xs text-muted">{description}</p>}
				<SchemaEditorProvider {...props}>
					<SchemaEditorContent
						onSave={onSave}
						ref={ref}
						showPreview={showPreview}
						showRootTypeSelector={showRootTypeSelector}
					/>
				</SchemaEditorProvider>
			</div>
		);
	},
);
