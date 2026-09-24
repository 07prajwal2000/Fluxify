import { Button, DeleteIconButton, Label, NumberField, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { useState } from "react";
import { TbPackage, TbPlus, TbRefresh } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectPackagesQuery } from "@/query/projectPackagesQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { InstallPackageModal } from "./InstallPackageModal";
import { PackagesRollout } from "./PackagesRollout";

export function PackagesSettings({ projectId }: { projectId: string }) {
	const { data, isLoading, refetch } = projectPackagesQuery.list.useQuery(projectId);
	const [checkUpdates, setCheckUpdates] = useState(false);
	const updates = projectPackagesQuery.updates.useQuery(projectId, checkUpdates);
	const install = projectPackagesQuery.install.useMutation(projectId);
	const remove = projectPackagesQuery.remove.useMutation(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const [installOpen, setInstallOpen] = useState(false);
	const [removing, setRemoving] = useState<string | null>(null);

	const minAge = data?.minReleaseAgeDays ?? 7;
	const latest = new Map((updates.data ?? []).map((u) => [u.name, u]));

	function saveMinAge(days: number) {
		if (Number.isNaN(days) || days === minAge) return;
		upsert.mutate(
			{ key: "settings.packages.minReleaseAgeDays", value: String(days) } as RequestBodySchema,
			{
				onSuccess: () => {
					toast.success("Minimum release age saved");
					refetch();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	function update(name: string, version: string) {
		install.mutate(
			{ packages: [{ name, version }] },
			{
				onSuccess: () => {
					toast.success(`${name} updating to ${version}`);
					updates.refetch();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	function confirmRemove() {
		if (!removing) return;
		remove.mutate([removing], {
			onSuccess: () => toast.success(`${removing} removed`),
			onError: (e) => showErrorNotification(e as Error),
			onSettled: () => setRemoving(null),
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">npm packages</h1>
					<p className="text-sm text-muted">
						Packages every route, workflow and custom block in this project can import.
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						isPending={updates.isFetching}
						isDisabled={!data?.packages.length}
						onPress={() => (checkUpdates ? updates.refetch() : setCheckUpdates(true))}
					>
						<TbRefresh size={16} /> Check for updates
					</Button>
					<Button variant="primary" onPress={() => setInstallOpen(true)}>
						<TbPlus size={16} /> Install
					</Button>
				</div>
			</div>

			<PackagesRollout projectId={projectId} />

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : !data?.packages.length ? (
				<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-sm text-muted">
					<TbPackage size={28} />
					<p>
						No packages yet. Install one, then <code>import</code> it in your code.
					</p>
				</div>
			) : (
				<div className="flex flex-col divide-y divide-border rounded-lg border border-border">
					{data.packages.map((pkg) => {
						const next = latest.get(pkg.name);
						return (
							<div key={pkg.name} className="flex items-center justify-between gap-4 px-4 py-3">
								<div className="flex flex-col">
									<span className="font-mono text-sm text-foreground">{pkg.name}</span>
									<span className="text-xs text-muted">
										{pkg.version ?? "unresolved"} · range {pkg.range}
									</span>
								</div>
								<div className="flex items-center gap-2">
									{next?.hasUpdate && next.latest && (
										<Button
											size="sm"
											variant="outline"
											isPending={install.isPending}
											onPress={() => update(pkg.name, next.latest!)}
										>
											Update to {next.latest}
										</Button>
									)}
									{next && !next.hasUpdate && (
										<span className="text-xs text-muted">up to date</span>
									)}
									<DeleteIconButton
										aria-label={`Remove ${pkg.name}`}
										onPress={() => setRemoving(pkg.name)}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}

			<div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-4">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-foreground">Minimum release age</h3>
					<p className="text-sm text-muted">
						Only install versions published at least this many days ago, for every package and its
						dependencies. Protects against freshly hijacked releases.
					</p>
				</div>
				<NumberField
					defaultValue={minAge}
					key={minAge}
					minValue={0}
					maxValue={365}
					onChange={saveMinAge}
					className="w-36 shrink-0"
				>
					<Label>Days</Label>
					<NumberField.Group>
						<NumberField.DecrementButton />
						<NumberField.Input />
						<NumberField.IncrementButton />
					</NumberField.Group>
				</NumberField>
			</div>

			<InstallPackageModal
				projectId={projectId}
				minReleaseAgeDays={minAge}
				isOpen={installOpen}
				onOpenChange={setInstallOpen}
			/>
			<ConfirmDialog
				open={Boolean(removing)}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Remove ${removing}?`}
				confirmText="Remove"
				danger
				pending={remove.isPending}
				onConfirm={confirmRemove}
			>
				Any route, workflow or custom block that still imports it will fail to compile and keep
				running its last version, which then errors at runtime. Remove those imports first.
			</ConfirmDialog>
		</div>
	);
}
