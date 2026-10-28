import { Checkbox, Chip } from "@fluxify/components";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export type BulkSuite = { id: string; name: string; enabled: boolean };

/**
 * Pick the suites to run (#668). Disabled suites are listed, tagged and unticked,
 * so a destructive one runs only when the user ticks it on purpose.
 */
export function RunBulkDialog({
	open,
	suites,
	pending,
	onClose,
	onRun,
}: {
	open: boolean;
	suites: BulkSuite[];
	pending: boolean;
	onClose: () => void;
	onRun: (ids: string[]) => void;
}) {
	const [ticked, setTicked] = useState<Set<string>>(new Set());
	useEffect(() => {
		if (open) setTicked(new Set(suites.filter((s) => s.enabled).map((s) => s.id)));
	}, [open, suites]);

	// list order, so the run request reads the way the list does
	const ids = suites.filter((s) => ticked.has(s.id)).map((s) => s.id);
	const disabledTicked = suites.filter((s) => !s.enabled && ticked.has(s.id)).length;
	const toggle = (id: string, on: boolean) =>
		setTicked((prev) => {
			const next = new Set(prev);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={(o) => !o && !pending && onClose()}
			title="Run bulk actions"
			confirmText={ids.length ? `Run ${ids.length}` : "Run"}
			confirmDisabled={ids.length === 0}
			pending={pending}
			onConfirm={() => onRun(ids)}
		>
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<span>Tick the suites to run.</span>
					<Checkbox
						isSelected={ids.length === suites.length}
						isIndeterminate={ids.length > 0 && ids.length < suites.length}
						onChange={(on) => setTicked(new Set(on ? suites.map((s) => s.id) : []))}
						label="Select all"
					/>
				</div>
				<div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
					{suites.map((s) => (
						<div key={s.id} className="flex items-center gap-2">
							<Checkbox
								isSelected={ticked.has(s.id)}
								onChange={(on) => toggle(s.id, on)}
								label={s.name || "Untitled suite"}
							/>
							{!s.enabled && (
								<Chip size="sm" color="warning">
									disabled
								</Chip>
							)}
						</div>
					))}
				</div>
				{disabledTicked > 0 && (
					<p className="text-xs text-warning">
						Run {ids.length} suite{ids.length === 1 ? "" : "s"}, including {disabledTicked} that{" "}
						{disabledTicked === 1 ? "is" : "are"} disabled?
					</p>
				)}
			</div>
		</ConfirmDialog>
	);
}
