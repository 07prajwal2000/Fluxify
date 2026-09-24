import {
	Button,
	Checkbox,
	CloseButton,
	CustomSelect,
	Input,
	Modal,
	Spinner,
	toast,
} from "@fluxify/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { npmVersions, searchNpm } from "@/lib/npmRegistry";
import { projectPackagesQuery } from "@/query/projectPackagesQuery";

const LATEST = "latest";

export function InstallPackageModal({
	projectId,
	minReleaseAgeDays,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	minReleaseAgeDays: number;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<string | null>(null);
	const [version, setVersion] = useState(LATEST);
	const [trust, setTrust] = useState(false);
	const [accepted, setAccepted] = useState(false);
	const install = projectPackagesQuery.install.useMutation(projectId);

	useEffect(() => {
		const t = setTimeout(() => setQuery(text.trim()), 300);
		return () => clearTimeout(t);
	}, [text]);

	const search = useQuery({
		queryKey: ["npm-search", query],
		queryFn: ({ signal }) => searchNpm(query, signal),
		enabled: query.length > 1 && !picked,
		staleTime: 60_000,
	});
	const versions = useQuery({
		queryKey: ["npm-versions", picked],
		queryFn: () => npmVersions(picked!),
		enabled: Boolean(picked),
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

	function close() {
		setText("");
		setQuery("");
		setPicked(null);
		setVersion(LATEST);
		setTrust(false);
		setAccepted(false);
		onOpenChange(false);
	}

	function submit() {
		if (!picked) return;
		install.mutate(
			{
				packages: [{ name: picked, ...(version === LATEST ? {} : { version }) }],
				trust,
			},
			{
				onSuccess: () => {
					toast.success(`${picked} added, installing on workers`);
					close();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={(o) => !o && close()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header>
							<div className="flex items-center justify-between">
								<Modal.Heading>Install npm package</Modal.Heading>
								<CloseButton onPress={close} />
							</div>
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-4 py-2">
							{picked ? (
								<div className="flex flex-col gap-4">
									<div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary px-3 py-2">
										<span className="font-mono text-sm text-foreground">{picked}</span>
										<Button size="sm" variant="ghost" onPress={() => setPicked(null)}>
											Change
										</Button>
									</div>
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
									<div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
										<TbAlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
										<div className="flex flex-col gap-2">
											<p>
												Packages run with full access on every worker: env, network, files and
												secrets. Only install packages you trust.
											</p>
											<Checkbox
												isSelected={accepted}
												onChange={setAccepted}
												label="I understand the risk"
											/>
										</div>
									</div>
								</div>
							) : (
								<div className="flex flex-col gap-3">
									<Input
										autoFocus
										placeholder="Search npm packages"
										value={text}
										onChange={(e) => setText(e.target.value)}
									/>
									<div className="flex max-h-[300px] flex-col gap-1 overflow-y-auto">
										{search.isFetching && <Spinner size="sm" />}
										{search.data?.map((hit) => (
											<button
												key={hit.name}
												type="button"
												onClick={() => setPicked(hit.name)}
												className="flex flex-col rounded-lg p-2 text-left transition-colors hover:bg-surface-secondary"
											>
												<span className="font-mono text-sm text-foreground">
													{hit.name} <span className="text-muted">{hit.version}</span>
												</span>
												{hit.description && (
													<span className="line-clamp-1 text-xs text-muted">{hit.description}</span>
												)}
											</button>
										))}
									</div>
								</div>
							)}
						</Modal.Body>
						{picked && (
							<Modal.Footer>
								<Button variant="outline" onPress={close}>
									Cancel
								</Button>
								<Button
									variant="primary"
									isDisabled={!accepted}
									isPending={install.isPending}
									onPress={submit}
								>
									Install
								</Button>
							</Modal.Footer>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
