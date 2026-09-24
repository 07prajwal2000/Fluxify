import { Button, Checkbox, CloseButton, CustomSelect, Spinner, toast } from "@fluxify/components";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TbAlertTriangle, TbExternalLink } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { type NpmSearchHit, npmVersions } from "@/lib/npmRegistry";
import { projectPackagesQuery } from "@/query/projectPackagesQuery";

const LATEST = "latest";

/** The install modal's right-hand sidebar for one picked package. Keyed by name, so picking another resets it. */
export function PackageDetailsPanel({
	projectId,
	hit,
	minReleaseAgeDays,
	onClose,
	onInstalled,
}: {
	projectId: string;
	hit: NpmSearchHit;
	minReleaseAgeDays: number;
	onClose: () => void;
	onInstalled: () => void;
}) {
	const [version, setVersion] = useState(LATEST);
	const [trust, setTrust] = useState(false);
	const [accepted, setAccepted] = useState(false);
	const install = projectPackagesQuery.install.useMutation(projectId);
	const versions = useQuery({
		queryKey: ["npm-versions", hit.name],
		queryFn: () => npmVersions(hit.name),
		staleTime: 60_000,
	});

	const cutoff = Date.now() - minReleaseAgeDays * 86_400_000;
	const versionOptions = [
		{ value: LATEST, label: `Newest allowed (${minReleaseAgeDays}+ days old)` },
		...(versions.data ?? []).slice(0, 50).map((v) => ({
			value: v.version,
			label: Date.parse(v.time) > cutoff ? `${v.version} (too new)` : v.version,
		})),
	];

	function submit() {
		install.mutate(
			{ packages: [{ name: hit.name, ...(version === LATEST ? {} : { version }) }], trust },
			{
				onSuccess: () => {
					toast.success(`${hit.name} added, installing on workers`);
					onInstalled();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border pl-5">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="truncate font-mono text-sm font-semibold text-foreground">{hit.name}</h3>
					<a
						href={`https://www.npmjs.com/package/${hit.name}`}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
					>
						npmjs.com <TbExternalLink size={12} />
					</a>
				</div>
				<CloseButton aria-label="Close details" onPress={onClose} />
			</div>
			{hit.description && <p className="text-xs text-muted">{hit.description}</p>}

			{versions.isLoading ? (
				<Spinner size="sm" />
			) : (
				<CustomSelect
					label="Version"
					options={versionOptions}
					value={version}
					onChange={setVersion}
				/>
			)}
			<Checkbox
				isSelected={trust}
				onChange={setTrust}
				label="Allow install scripts"
				description="Only needed when a package builds or downloads a binary on install."
			/>
			<div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
				<TbAlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
				<div className="flex flex-col gap-2">
					<p>
						Packages run with full access on every worker: env, network, files and secrets. Only
						install packages you trust.
					</p>
					<Checkbox isSelected={accepted} onChange={setAccepted} label="I understand the risk" />
				</div>
			</div>
			<Button
				variant="primary"
				isDisabled={!accepted}
				isPending={install.isPending}
				onPress={submit}
			>
				Install
			</Button>
		</aside>
	);
}
