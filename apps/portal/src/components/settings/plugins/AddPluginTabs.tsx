import { Button, Input, Label, Spinner, TextField, toast } from "@fluxify/components";
import { useState } from "react";
import { parseApiError } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import type { Plugin } from "@/services/plugins";
import { Badge } from "./PluginBadges";

type TabProps = { projectId: string; onAdded: (plugin: Plugin) => void };

/** the server's validation message, verbatim: it says what is wrong with the package */
function ServerError({ error }: { error: unknown }) {
	if (!error) return null;
	return (
		<p
			role="alert"
			className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
		>
			{parseApiError(error).message}
		</p>
	);
}

const hint = "text-xs text-muted";

export function UploadTab({ projectId, onAdded }: TabProps) {
	const upload = pluginsQuery.upload.useMutation(projectId);
	const [file, setFile] = useState<File>();
	return (
		<div className="flex flex-col gap-3">
			<Label className="text-xs font-semibold uppercase tracking-wider text-foreground">
				Plugin archive (.tgz)
			</Label>
			<input
				type="file"
				accept=".tgz,.tar.gz,application/gzip"
				aria-label="Plugin archive"
				onChange={(e) => setFile(e.currentTarget.files?.[0])}
				className="text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
			/>
			<p className={hint}>
				Built with the Fluxify CLI. To upgrade a plugin, upload its new version.
			</p>
			<ServerError error={upload.error} />
			<Button
				variant="primary"
				className="self-end"
				isDisabled={!file}
				isPending={upload.isPending}
				onPress={() => file && upload.mutate(file, { onSuccess: onAdded })}
			>
				Upload
			</Button>
		</div>
	);
}

export function NpmTab({ projectId, onAdded }: TabProps) {
	const add = pluginsQuery.addNpm.useMutation(projectId);
	const [spec, setSpec] = useState("");
	return (
		<div className="flex flex-col gap-3">
			<TextField value={spec} onChange={setSpec}>
				<Label>Package and exact version</Label>
				<Input placeholder="@acme/fluxify-slack@1.2.0" />
			</TextField>
			<p className={hint}>A version range or a tag such as latest is not accepted.</p>
			<ServerError error={add.error} />
			<Button
				variant="primary"
				className="self-end"
				isDisabled={!spec.trim()}
				isPending={add.isPending}
				onPress={() => add.mutate(spec.trim(), { onSuccess: onAdded })}
			>
				Add
			</Button>
		</div>
	);
}

/** Two steps: record the URL, then let the server download it. Nothing is fetched before the second. */
export function UrlTab({ projectId, onAdded }: TabProps) {
	const requests = pluginsQuery.urlRequests.useQuery(projectId, true);
	const request = pluginsQuery.requestUrl.useMutation(projectId);
	const fetchUrl = pluginsQuery.fetchUrl.useMutation(projectId);
	const [url, setUrl] = useState("");
	return (
		<div className="flex flex-col gap-3">
			<TextField value={url} onChange={setUrl}>
				<Label>Tarball URL</Label>
				<Input placeholder="https://releases.example.com/slack-1.2.0.tgz" />
			</TextField>
			<p className={hint}>
				Only domains your administrator trusts. Requesting records the URL; the download starts when
				you allow it below.
			</p>
			<ServerError error={request.error} />
			<Button
				variant="primary"
				className="self-end"
				isDisabled={!url.trim()}
				isPending={request.isPending}
				onPress={() =>
					request.mutate(url.trim(), {
						onSuccess: () => {
							setUrl("");
							toast.success("URL recorded. Allow the fetch to download it.");
						},
					})
				}
			>
				Request
			</Button>
			{requests.isLoading && <Spinner size="sm" />}
			{!!requests.data?.length && (
				<ul
					aria-label="URL requests"
					className="flex flex-col divide-y divide-border rounded-lg border border-border"
				>
					{requests.data.map((r) => (
						<li key={r.id} className="flex flex-col gap-1 px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<span className="min-w-0 truncate font-mono text-xs text-foreground">{r.url}</span>
								{r.status === "awaiting_fetch" ? (
									<Button
										size="sm"
										variant="outline"
										isPending={fetchUrl.isPending && fetchUrl.variables === r.id}
										onPress={() => fetchUrl.mutate(r.id, { onSuccess: onAdded })}
									>
										Allow fetch
									</Button>
								) : r.status === "fetched" ? (
									<Badge tone="success">{r.pluginName ?? "Fetched"}</Badge>
								) : (
									<Badge tone="danger">Failed</Badge>
								)}
							</div>
							{r.lastError && <p className="text-xs text-danger">{r.lastError}</p>}
						</li>
					))}
				</ul>
			)}
			<ServerError error={fetchUrl.error} />
		</div>
	);
}

export function FolderTab({ projectId, onAdded }: TabProps) {
	const found = pluginsQuery.fsCandidates.useQuery(projectId, true);
	const add = pluginsQuery.addFs.useMutation(projectId);
	return (
		<div className="flex flex-col gap-3">
			<p className={hint}>
				Plugin directories in the instance's plugins folder, which every worker must also see.
			</p>
			{found.isLoading && <Spinner size="sm" />}
			<ServerError error={found.error} />
			{found.data && !found.data.length && (
				<p className="text-sm text-muted">No plugin directories found.</p>
			)}
			{!!found.data?.length && (
				<ul
					aria-label="Plugin folders"
					className="flex flex-col divide-y divide-border rounded-lg border border-border"
				>
					{found.data.map((c) => (
						<li key={c.path} className="flex flex-col gap-1 px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<div className="flex min-w-0 flex-col">
									<span className="font-mono text-xs text-foreground">{c.path}</span>
									{c.name && (
										<span className={hint}>
											{c.name}@{c.version}
										</span>
									)}
								</div>
								<Button
									size="sm"
									variant="outline"
									isDisabled={Boolean(c.error)}
									isPending={add.isPending && add.variables === c.path}
									onPress={() => add.mutate(c.path, { onSuccess: onAdded })}
								>
									Add
								</Button>
							</div>
							{c.error && <p className="text-xs text-danger">{c.error}</p>}
						</li>
					))}
				</ul>
			)}
			<ServerError error={add.error} />
		</div>
	);
}
