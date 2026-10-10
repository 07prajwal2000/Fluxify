import { Button, CloseButton, Modal } from "@fluxify/components";
import { lazy, Suspense, useState } from "react";
import { TbArrowsMaximize } from "react-icons/tb";
import { Fold } from "./Collapsible";
import { type CanvasDiff, countBy } from "./canvasDiff";
import { FieldDiff } from "./FieldDiff";

// ReactFlow is only loaded once a diff is on screen
const CanvasDiffGraph = lazy(() => import("./CanvasDiffGraph"));

const LEGEND = [
	["added", "bg-success"],
	["changed", "bg-warning"],
	["removed", "bg-danger"],
] as const;
const CHIP: Record<string, string> = {
	added: "border-success/50 text-success",
	changed: "border-warning/50 text-warning",
	removed: "border-danger/50 text-danger",
};

function Legend({ diff }: { diff: CanvasDiff }) {
	const count = countBy(diff);
	return (
		<ul className="flex flex-wrap items-center gap-3 text-xs text-muted" aria-label="Legend">
			{LEGEND.map(([status, dot]) => (
				<li key={status} className="flex items-center gap-1.5">
					<span className={`size-2 rounded-full ${dot}`} />
					{count[status]} {status}
				</li>
			))}
		</ul>
	);
}

const Loading = () => <div className="h-64 animate-pulse rounded-lg bg-surface-secondary" />;

/** The canvas at full size, with the block settings panel (a double click on a block). */
function ExpandedCanvas({
	diff,
	selected,
	onSelect,
	onClose,
}: {
	diff: CanvasDiff;
	selected?: string;
	onSelect: (key: string) => void;
	onClose: (open: boolean) => void;
}) {
	return (
		<Modal isOpen onOpenChange={onClose}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog
						aria-label="Canvas changes"
						className="flex h-[min(820px,90vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50"
					>
						<Modal.Header className="flex h-11 shrink-0 flex-row items-center gap-4 border-b border-border px-4 py-0">
							<Modal.Heading className="text-sm font-semibold">Canvas changes</Modal.Heading>
							<Legend diff={diff} />
							{!diff.partial && (
								<span className="text-xs text-muted">Double-click a block for its settings</span>
							)}
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">
							<Suspense fallback={<Loading />}>
								<CanvasDiffGraph expanded diff={diff} selected={selected} onSelect={onSelect} />
							</Suspense>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

/**
 * What an edit does to a canvas: the canvas itself (expandable), and under a
 * fold a chip per touched block with the field-level before/after of the one
 * you pick (a changed one first).
 */
export function CanvasDiffView({ diff }: { diff: CanvasDiff }) {
	const touched = diff.blocks.filter((b) => b.status !== "same");
	const [picked, setPicked] = useState<string>();
	const [listed, setListed] = useState(false);
	const [big, setBig] = useState(false);
	const open = diff.blocks.find((b) => b.key === (picked ?? touched[0]?.key));
	// a block picked on the canvas opens the fold, so what happened to it is in view
	const pick = (key: string) => {
		setPicked(key);
		setListed(true);
	};
	return (
		<div className="flex flex-col gap-2">
			<Legend diff={diff} />
			<div className="relative">
				{/* one canvas at a time: the expanded one replaces this while it is open */}
				{big ? (
					<div className="h-64 rounded-lg border border-border bg-surface-secondary" />
				) : (
					<Suspense fallback={<Loading />}>
						<CanvasDiffGraph diff={diff} selected={open?.key} onSelect={pick} />
					</Suspense>
				)}
				<Button
					isIconOnly
					size="sm"
					variant="secondary"
					aria-label="Expand canvas"
					className="absolute top-2 right-2 z-10"
					onPress={() => setBig(true)}
				>
					<TbArrowsMaximize size={14} />
				</Button>
			</div>
			{big && <ExpandedCanvas diff={diff} selected={open?.key} onSelect={pick} onClose={setBig} />}
			{touched.length > 0 && (
				<Fold label={`Changed blocks (${touched.length})`} open={listed} onToggle={setListed}>
					<div className="flex flex-col gap-2">
						<div className="flex flex-wrap gap-1.5" role="group" aria-label="Touched blocks">
							{touched.map((b) => (
								<button
									key={b.key}
									type="button"
									aria-pressed={open?.key === b.key}
									onClick={() => setPicked(b.key)}
									className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono text-xs ${
										CHIP[b.status]
									} ${open?.key === b.key ? "bg-surface-secondary" : "bg-surface"}`}
								>
									{b.key}
								</button>
							))}
						</div>
						{open && open.status !== "same" && (
							<section
								aria-label={`${open.key} ${open.status}`}
								className="rounded-lg border border-border p-2"
							>
								<h4 className="mb-2 font-mono text-xs font-medium text-foreground">
									{open.key} <span className="font-sans text-muted">({open.status})</span>
								</h4>
								<FieldDiff changes={open.changes} />
							</section>
						)}
					</div>
				</Fold>
			)}
		</div>
	);
}
