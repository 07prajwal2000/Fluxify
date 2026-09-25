import { Checkbox, Label, ListBox, Select } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { SuiteDraft } from "./types";

const inputClass =
	"w-24 rounded-md border border-border bg-background-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent";

const NONE = "__none__";

function PhasePicker({
	label,
	help,
	blocks,
	blockId,
	timeoutMs,
	onChange,
}: {
	label: string;
	help: string;
	blocks: { id: string; label: string }[];
	blockId: string | null;
	timeoutMs: number;
	onChange: (next: { blockId: string | null; timeoutMs: number }) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label>{label}</Label>
			<p className="text-xs text-muted">{help}</p>
			<div className="flex items-center gap-3">
				<Select
					aria-label={label}
					selectedKey={blockId ?? NONE}
					onSelectionChange={(key) =>
						onChange({ blockId: key === NONE ? null : String(key), timeoutMs })
					}
					className="w-64"
				>
					<Select.Trigger>
						<span className="truncate text-xs">
							{blocks.find((b) => b.id === blockId)?.label ?? "None"}
						</span>
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							<ListBox.Item id={NONE} textValue="None">
								<span className="text-xs">None</span>
								<ListBox.ItemIndicator />
							</ListBox.Item>
							{blocks.map((b) => (
								<ListBox.Item key={b.id} id={b.id} textValue={b.label}>
									<span className="text-xs">{b.label}</span>
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
				{blockId && (
					<label className="flex items-center gap-2 text-xs text-muted">
						Time limit
						<input
							type="number"
							min={1}
							max={600}
							className={inputClass}
							value={Math.round(timeoutMs / 1000)}
							onChange={(e) =>
								onChange({
									blockId,
									timeoutMs: Math.min(600, Math.max(1, Number(e.target.value) || 1)) * 1000,
								})
							}
						/>
						seconds
					</label>
				)}
			</div>
		</div>
	);
}

/**
 * Setup / teardown (#483): test-only custom blocks that run before and after
 * this suite's request — seed data, then clean it up.
 */
export function SetupEditor({
	projectId,
	draft,
	onChange,
}: {
	projectId: string;
	draft: SuiteDraft;
	onChange: (next: Partial<SuiteDraft>) => void;
}) {
	const { data } = customBlocksQuery.getAll.useQuery(projectId);
	const blocks = (data ?? [])
		.filter((b) => b.testOnly)
		.map((b) => ({ id: b.id, label: b.label || b.name }));

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			{blocks.length === 0 && (
				<p className="rounded-lg border border-border bg-background-secondary p-3 text-xs text-muted">
					No setup blocks yet. Create a{" "}
					<Link
						to="/$projectId/custom-blocks"
						params={{ projectId }}
						className="text-accent hover:underline"
					>
						custom block
					</Link>{" "}
					and tick <em>Use only for test suite setup / teardown</em> in its settings.
				</p>
			)}

			<PhasePicker
				label="Setup"
				help="Runs before the request, for example to add test data. If it fails, the request is skipped and the suite fails."
				blocks={blocks}
				blockId={draft.setupBlockId}
				timeoutMs={draft.setupTimeoutMs}
				onChange={({ blockId, timeoutMs }) =>
					onChange({ setupBlockId: blockId, setupTimeoutMs: timeoutMs })
				}
			/>

			<PhasePicker
				label="Teardown"
				help="Runs after the request and checks, even when they fail, for example to remove the test data. If it fails, the suite keeps its result and shows a warning."
				blocks={blocks}
				blockId={draft.teardownBlockId}
				timeoutMs={draft.teardownTimeoutMs}
				onChange={({ blockId, timeoutMs }) =>
					onChange({ teardownBlockId: blockId, teardownTimeoutMs: timeoutMs })
				}
			/>

			<Checkbox
				isSelected={draft.runAlone}
				onChange={(runAlone) => onChange({ runAlone })}
				label="Run alone"
				description="Suites normally run at the same time. Tick this to run this suite by itself, after the others, when its data must not mix with theirs."
			/>
		</div>
	);
}
