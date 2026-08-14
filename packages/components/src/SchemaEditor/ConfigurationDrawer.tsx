import { Button, Drawer } from "@heroui/react";
import { TbX } from "react-icons/tb";
import { useSchemaEditorContext } from "./context";
import type { SchemaProperty } from "./types";
import { getAtPath } from "./utils";

/**
 * Rules live in a drawer rather than inline: a string has seven of them, and
 * putting that on every row would bury the shape the editor exists to show.
 */
export function ConfigurationDrawer() {
	const {
		schema,
		drawerPath,
		closeDrawer,
		updateProperty,
		isReadOnly,
		jsEditorRows,
		ruleEditors,
		labelFor,
	} = useSchemaEditorContext();

	const node = drawerPath ? getAtPath(schema, drawerPath) : undefined;
	const RuleEditor = node ? ruleEditors[node.dataType] : undefined;
	const title = node
		? `Configure ${(node as SchemaProperty).key ? `"${(node as SchemaProperty).key}"` : "field"}`
		: "Configure field";

	return (
		<Drawer.Backdrop
			isOpen={drawerPath !== null}
			onOpenChange={(isOpen) => {
				if (!isOpen) closeDrawer();
			}}
		>
			<Drawer.Content placement="right">
				<Drawer.Dialog
					aria-label={title}
					className="flex w-full max-w-xl flex-col"
				>
					{/* .drawer__header is flex-col in HeroUI's CSS; the row lives in a
					    child so we are not fighting utility order to undo it. */}
					<Drawer.Header>
						<div className="flex w-full flex-row items-center gap-2">
							<Drawer.Heading className="min-w-0 flex-1 truncate text-sm font-medium">
								{title}
							</Drawer.Heading>
							{node && (
								<span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
									{labelFor(node.dataType)}
								</span>
							)}
							<Button
								aria-label="Close configuration"
								isIconOnly
								onPress={closeDrawer}
								size="sm"
								variant="ghost"
							>
								<TbX className="size-4" />
							</Button>
						</div>
					</Drawer.Header>

					<Drawer.Body className="flex-1 overflow-auto">
						{RuleEditor && node ? (
							<RuleEditor
								isReadOnly={isReadOnly}
								jsEditorRows={jsEditorRows}
								node={node}
								onUpdate={(updates) =>
									drawerPath && updateProperty(drawerPath, updates)
								}
							/>
						) : (
							<p className="text-sm text-muted">
								No configuration is available for this type.
							</p>
						)}
					</Drawer.Body>
				</Drawer.Dialog>
			</Drawer.Content>
		</Drawer.Backdrop>
	);
}
