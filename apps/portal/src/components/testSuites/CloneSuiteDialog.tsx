import { ListBox, Select, toast } from "@fluxify/components";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { routesQuery } from "@/query/routesQuery";
import { testSuitesQuery } from "@/query/testSuitesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { SuiteTarget } from "@/services/testSuites";

const keyOf = (target: SuiteTarget) => `${target.type}:${target.id}`;

/**
 * Copy a suite to a route or workflow of this project (#497). The current
 * target starts selected, so Confirm alone duplicates the suite in place.
 */
export function CloneSuiteDialog({
	projectId,
	target,
	suite,
	onClose,
	onCloned,
}: {
	projectId: string;
	target: SuiteTarget;
	suite: { id: string; name: string } | null;
	onClose: () => void;
	onCloned: (id: string, target: SuiteTarget) => void;
}) {
	const [selected, setSelected] = useState(keyOf(target));
	useEffect(() => {
		if (suite) setSelected(keyOf(target));
	}, [suite, target]);

	// 50 is the server's max perPage, like the canvas switchers
	const routes = routesQuery.getAll.useQuery({ projectId, perPage: 50 });
	const workflows = workflowsQuery.getAll.useQuery({ projectId, perPage: 50 });
	const options = [
		...(routes.data?.data ?? []).map((r) => ({
			key: `route:${r.id}`,
			label: `Route · ${r.method} ${r.path}${r.name ? ` (${r.name})` : ""}`,
		})),
		...(workflows.data?.data ?? []).map((w) => ({
			key: `workflow:${w.id}`,
			label: `Workflow · ${w.name ?? "Untitled"}`,
		})),
	];
	const clone = testSuitesQuery.clone.mutation();

	async function onConfirm() {
		if (!suite) return;
		const [type, id] = selected.split(":") as [SuiteTarget["type"], string];
		try {
			const result = await clone.mutateAsync({ id: suite.id, target: { type, id } });
			toast.success(`Cloned "${suite.name}"`);
			if (result.droppedHooks.length) {
				toast.warning(`Hooks not copied, no matching block: ${result.droppedHooks.join(", ")}`);
			}
			onClose();
			onCloned(result.id, { type, id });
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	return (
		<ConfirmDialog
			open={!!suite}
			onOpenChange={(open) => !open && !clone.isPending && onClose()}
			title="Clone test suite"
			confirmText="Clone"
			pending={clone.isPending}
			onConfirm={() => void onConfirm()}
		>
			<div className="flex flex-col gap-3">
				<span>
					Copy {suite?.name || "this suite"} with its checks, hooks, setup and overrides. Copying
					between a route and a workflow leaves the request or input empty.
				</span>
				<Select
					aria-label="Clone to"
					selectedKey={selected}
					onSelectionChange={(key) => key && setSelected(String(key))}
					isDisabled={clone.isPending}
				>
					<Select.Trigger>
						<span className="truncate text-xs text-foreground">
							{options.find((o) => o.key === selected)?.label ?? "Pick a route or workflow"}
						</span>
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{options.map((o) => (
								<ListBox.Item key={o.key} id={o.key} textValue={o.label}>
									<span className="truncate text-xs">{o.label}</span>
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
			</div>
		</ConfirmDialog>
	);
}
