import { useMemo, useState } from "react";
import { Button, Input, Label, TextField } from "@fluxify/components";
import { TbX } from "react-icons/tb";
import { BLOCK_CATALOG } from "./blockCatalog";

export function BlockPalette({
	open,
	onClose,
	onAdd,
}: {
	open: boolean;
	onClose: () => void;
	onAdd: (type: string) => void;
}) {
	const [query, setQuery] = useState("");

	const groups = useMemo(() => {
		const q = query.toLowerCase();
		return BLOCK_CATALOG.map((g) => ({
			...g,
			blocks: g.blocks.filter((b) => b.label.toLowerCase().includes(q)),
		})).filter((g) => g.blocks.length > 0);
	}, [query]);

	if (!open) return null;

	return (
		<div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-border bg-background-secondary">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<span className="font-medium">Add block</span>
				<Button isIconOnly variant="ghost" aria-label="Close" onPress={onClose}>
					<TbX size={16} />
				</Button>
			</div>
			<div className="p-3">
				<TextField value={query} onChange={setQuery} aria-label="Search blocks">
					<Label className="sr-only">Search</Label>
					<Input placeholder="Search blocks…" autoFocus />
				</TextField>
			</div>
			<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
				{groups.map((g) => (
					<div key={g.group} className="flex flex-col gap-1">
						<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
							{g.group}
						</div>
						{g.blocks.map((b) => (
							<button
								key={b.type}
								type="button"
								onClick={() => onAdd(b.type)}
								className="w-full rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-background"
							>
								{b.label}
							</button>
						))}
					</div>
				))}
				{groups.length === 0 && (
					<p className="text-center text-sm text-muted">No blocks match.</p>
				)}
			</div>
		</div>
	);
}
