import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField } from "../fields";
import type { BlockNode } from "../../types";

/** For Loop block settings: Start, End, Step. */
export function ForLoopSettings({ block }: { block: BlockNode }) {
	const start = block.data.start;
	const end = block.data.end;
	const step = block.data.step;

	const isAnyValueJs =
		(typeof start === "string" && (start.startsWith("js:") || isNaN(Number(start)))) ||
		(typeof end === "string" && (end.startsWith("js:") || isNaN(Number(end)))) ||
		(typeof step === "string" && (step.startsWith("js:") || isNaN(Number(step))));

	const startNum = Number(start);
	const endNum = Number(end);
	const stepNum = Number(step);

	const isNumeric =
		start !== undefined &&
		start !== "" &&
		!isNaN(startNum) &&
		end !== undefined &&
		end !== "" &&
		!isNaN(endNum) &&
		step !== undefined &&
		step !== "" &&
		!isNaN(stepNum);

	const isInfiniteLoop =
		isNumeric &&
		(stepNum === 0 ||
			(startNum < endNum && stepNum < 0) ||
			(startNum > endNum && stepNum > 0));

	return (
		<div className="flex flex-col gap-4">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="start"
				label="Start"
				placeholder="e.g. 1 or js:expression"
				hint="Starting iteration count"
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="end"
				label="End"
				placeholder="e.g. 10 or js:expression"
				hint="Ending iteration count"
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="step"
				label="Step"
				placeholder="e.g. 1 or js:expression"
				hint="Step increment count"
			/>
			{(isInfiniteLoop || isAnyValueJs) && (
				<div className="rounded-md border border-[var(--warning-border,oklch(0.75_0.15_75))] bg-[var(--warning-bg,oklch(0.25_0.05_75))] p-3 text-xs text-[var(--warning-text,oklch(0.85_0.12_75))]">
					<div className="font-semibold mb-0.5">Warning</div>
					<div>
						{isInfiniteLoop
							? "Loop might be infinite, careful with the values"
							: "Careful with JS expressions, they can be unsafe if not used carefully"}
					</div>
				</div>
			)}
		</div>
	);
}

export function forLoopSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<ForLoopSettings block={block} />
		</BlockSettings.TabHead>
	);
}
