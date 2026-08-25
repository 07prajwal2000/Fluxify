import { useState } from "react";
import {
	Button,
	CloseButton,
	Modal,
	SchemaEditor,
} from "@fluxify/components";

/**
 * A field that opens a large schema in a modal instead of printing it inline,
 * used for `route` and `query` params, as well as `bodySchema` in the artifacts sidebar.
 */
export function SchemaField({
	label,
	current,
	next,
}: {
	label: string;
	current?: unknown;
	next?: unknown;
}) {
	const [isOpen, setIsOpen] = useState(false);

	const text = (v: unknown) =>
		v === undefined || v === null || v === ""
			? ""
			: typeof v === "string"
				? v
				: JSON.stringify(v, null, 2);

	const before = text(current);
	const after = text(next);
	const changed = after !== "" && after !== before;

	// Use `next` if changed, else `current`. Default to empty schema if neither.
	const schemaToRender = changed ? next : current;
	const isEmpty = !schemaToRender || Object.keys(schemaToRender as any).length === 0;

	return (
		<div>
			<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
				{label}
			</span>
			<div className="mt-1 flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-surface-secondary">
				<span className="text-sm font-medium text-foreground">
					{isEmpty ? "Empty Schema" : changed ? "Schema (modified)" : "Schema (unchanged)"}
				</span>
				<Button
					size="sm"
					variant="outline"
					isDisabled={isEmpty}
					onPress={() => setIsOpen(true)}
				>
					View Schema
				</Button>
			</div>

			<Modal isOpen={isOpen} onOpenChange={setIsOpen}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="lg" className="p-0">
						<Modal.Dialog className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
							<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
								<div className="min-w-0">
									<Modal.Heading className="text-sm font-semibold">
										{label}
									</Modal.Heading>
									<p className="truncate font-mono text-xs text-muted">
										{changed ? "Proposed changes" : "Current schema"}
									</p>
								</div>
								<CloseButton
									aria-label="Close schema viewer"
									className="ml-auto"
									onPress={() => setIsOpen(false)}
								/>
							</Modal.Header>
							<Modal.Body className="min-h-0 flex-1 p-0 overflow-y-auto bg-surface-secondary">
								<div className="p-5 h-full">
									<SchemaEditor
										value={schemaToRender as any}
										isReadOnly={true}
									/>
								</div>
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</div>
	);
}
