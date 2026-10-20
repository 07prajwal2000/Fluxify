import { Button, Spinner, toast } from "@fluxify/components";
import { useState } from "react";
import { TbPlug, TbPlus, TbRefresh } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import { useCanEditProject } from "@/store/auth";
import { AddPluginModal } from "./AddPluginModal";
import { PluginPage } from "./PluginPage";
import { PluginRow } from "./PluginRow";

/**
 * Settings → Plugins (#862): every plugin of the project with its approval,
 * status and dev/prod switches, and the way to add one. Creators and above act;
 * everyone else reads. A plugin opens in place, like a package's details.
 */
export function PluginsSettings({
	projectId,
	selected,
	onSelect,
}: {
	projectId: string;
	/** the open plugin's `scope/name`, when the page keeps it in the URL */
	selected?: string;
	onSelect?: (name: string | undefined) => void;
}) {
	const { data, isLoading } = pluginsQuery.list.useQuery(projectId);
	const scanAll = pluginsQuery.scanProject.useMutation(projectId);
	const editable = useCanEditProject(projectId);
	const [adding, setAdding] = useState(false);
	const [local, setLocal] = useState<string>();
	const opened = onSelect ? selected : local;
	const setOpened = onSelect ?? setLocal;

	const plugin = data?.find((p) => p.name === opened);
	if (plugin)
		return (
			<PluginPage
				projectId={projectId}
				plugin={plugin}
				editable={editable}
				onBack={() => setOpened(undefined)}
			/>
		);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
					<p className="text-sm text-muted">
						Blocks shipped as plugins. Nothing loads until a creator approves it.
					</p>
				</div>
				{editable && (
					<div className="flex gap-2">
						<Button
							variant="outline"
							isDisabled={!data?.length}
							isPending={scanAll.isPending}
							onPress={() =>
								scanAll.mutate(undefined, {
									onSuccess: () => toast.success("Scan finished"),
									onError: (e) => showErrorNotification(e),
								})
							}
						>
							<TbRefresh size={16} /> Scan all
						</Button>
						<Button variant="primary" onPress={() => setAdding(true)}>
							<TbPlus size={16} /> Add plugin
						</Button>
					</div>
				)}
			</div>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : !data?.length ? (
				<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-sm text-muted">
					<TbPlug size={28} />
					<p>No plugins yet.</p>
				</div>
			) : (
				<div className="flex flex-col divide-y divide-border rounded-lg border border-border">
					{data.map((p) => (
						<PluginRow
							key={p.id}
							projectId={projectId}
							plugin={p}
							editable={editable}
							onOpen={() => setOpened(p.name)}
						/>
					))}
				</div>
			)}

			<AddPluginModal projectId={projectId} isOpen={adding} onOpenChange={setAdding} />
		</div>
	);
}
