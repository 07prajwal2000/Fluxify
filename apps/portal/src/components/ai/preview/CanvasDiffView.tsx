import { lazy, Suspense, useState } from "react";
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

const Loading = ({ tall }: { tall: boolean }) => (
	<div className={`${tall ? "h-96" : "h-64"} animate-pulse rounded-lg bg-surface-secondary`} />
);

/**
 * What an edit does to a canvas: the canvas itself, and under a
 * fold a chip per touched block with the field-level before/after of the one
 * you pick (a changed one first).
 */
export function CanvasDiffView({ diff }: { diff: CanvasDiff }) {
	const touched = diff.blocks.filter((b) => b.status !== "same");
	const [picked, setPicked] = useState<string>();
	const [listed, setListed] = useState(false);
	const open = diff.blocks.find((b) => b.key === (picked ?? touched[0]?.key));
	// a block picked on the canvas opens the fold, so what happened to it is in view
	const pick = (key: string) => {
		setPicked(key);
		setListed(true);
	};
	return (
		<div className="flex flex-col gap-2">
			<Legend diff={diff} />
			<Suspense fallback={<Loading tall={!diff.partial} />}>
				<CanvasDiffGraph
					diff={diff}
					selected={open?.key}
					onSelect={pick}
					// ops alone leave most blocks without their data: nothing real to open
					panel={!diff.partial}
				/>
			</Suspense>
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
