import { type ReactNode, useRef, useState } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Two panes side by side with a draggable divider. Widths are percentages, so
 * the split holds when the container resizes. Arrow keys move the divider too.
 */
export function SplitPane({
	left,
	right,
	initial = 50,
	min = 15,
	max = 85,
	label = "Resize panes",
}: {
	left: ReactNode;
	right: ReactNode;
	/** left pane width in % */
	initial?: number;
	min?: number;
	max?: number;
	label?: string;
}) {
	const [percent, setPercent] = useState(initial);
	const root = useRef<HTMLDivElement>(null);

	function startDrag(event: React.PointerEvent) {
		const box = root.current?.getBoundingClientRect();
		if (!box) return;
		event.preventDefault();
		const move = (e: PointerEvent) =>
			setPercent(clamp(((e.clientX - box.left) / box.width) * 100, min, max));
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
	}

	function onKeyDown(event: React.KeyboardEvent) {
		const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
		if (!step) return;
		event.preventDefault();
		setPercent((current) => clamp(current + step, min, max));
	}

	return (
		<div ref={root} className="flex h-full min-h-0 w-full overflow-hidden">
			<div className="h-full min-w-0 shrink-0" style={{ width: `${percent}%` }}>
				{left}
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: interactive resizable separator needs pointer and keyboard handling */}
			<div
				role="separator"
				tabIndex={0}
				aria-orientation="vertical"
				aria-label={label}
				aria-valuenow={Math.round(percent)}
				aria-valuemin={min}
				aria-valuemax={max}
				onPointerDown={startDrag}
				onKeyDown={onKeyDown}
				className="group relative h-full w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
			>
				{/* Expanded hit target for effortless drag */}
				<div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
			</div>
			<div className="h-full min-w-0 flex-1 overflow-auto">{right}</div>
		</div>
	);
}
