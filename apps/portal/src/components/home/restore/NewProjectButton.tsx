import { Button, CloseButton, Modal } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { TbFileUpload, TbPlus } from "react-icons/tb";
import { SplitButton } from "@/components/common/SplitButton";
import { parseApiError } from "@/lib/errorNotifier";
import { projectsQuery } from "@/query/projectsQuery";
import { type ArchiveSummary, projectsService, type RestoreResult } from "@/services/projects";
import { type Names, RestoreDialog } from "./RestoreDialog";

type Pending = {
	file: File;
	summary: ArchiveSummary | null;
	refusal?: string;
	names: Names;
	error?: string;
};

/** "New Project", with a menu item that makes one from a backup or template file (#1104). */
export function NewProjectButton() {
	const navigate = useNavigate();
	const client = useQueryClient();
	const input = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [restoring, setRestoring] = useState(false);
	const [result, setResult] = useState<RestoreResult | null>(null);

	const open = (id: string) => navigate({ to: "/$projectId", params: { projectId: id } });

	const inspect = async (file: File) => {
		setPending({ file, summary: null, names: { name: "", slug: "" } });
		try {
			const summary = await projectsService.inspectArchive(file);
			setPending((p) => (p && p.file === file ? { ...p, summary, names: summary.suggested } : p));
		} catch (error) {
			const refusal = parseApiError(error).message;
			setPending((p) => (p && p.file === file ? { ...p, refusal } : p));
		}
	};

	const create = async () => {
		if (!pending) return;
		setRestoring(true);
		try {
			const done = await projectsService.restore(pending.file, pending.names);
			setPending(null);
			projectsQuery.invalidateAll(client);
			if (done.warnings.length > 0) setResult(done);
			else open(done.id);
		} catch (error) {
			const { message } = parseApiError(error);
			setPending((p) => p && { ...p, error: message });
		} finally {
			setRestoring(false);
		}
	};

	return (
		<>
			<SplitButton
				variant="primary"
				menuLabel="More ways to create a project"
				onPress={() => navigate({ to: "/projects/new" })}
				items={[
					{
						id: "from-file",
						label: "From backup or template file",
						icon: <TbFileUpload size={16} />,
						onAction: () => input.current?.click(),
					},
				]}
			>
				<TbPlus className="h-4 w-4" />
				New Project
			</SplitButton>
			<input
				ref={input}
				type="file"
				accept=".tar.gz,.tgz,application/gzip"
				aria-label="Backup or template file"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					// the same file can be picked again after a cancel
					e.target.value = "";
					if (file) void inspect(file);
				}}
			/>
			{pending && (
				<RestoreDialog
					fileName={pending.file.name}
					summary={pending.summary}
					refusal={pending.refusal}
					names={pending.names}
					onNames={(names) => setPending((p) => p && { ...p, names, error: undefined })}
					error={pending.error}
					isRestoring={restoring}
					onCreate={create}
					onClose={() => setPending(null)}
				/>
			)}
			{result && (
				<RestoredWithWarnings
					result={result}
					onOpen={() => open(result.id)}
					onClose={() => setResult(null)}
				/>
			)}
		</>
	);
}

/** `Plugin "acme/kv" needs approving…` names the plugin whose page fixes it */
const pluginOf = (w: RestoreResult["warnings"][number]) =>
	w.section === "plugins" ? /^Plugin "([^"]+)"/.exec(w.message)?.[1] : undefined;

function RestoredWithWarnings({
	result,
	onOpen,
	onClose,
}: {
	result: RestoreResult;
	onOpen: () => void;
	onClose: () => void;
}) {
	return (
		<Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Project created, with a few things to do</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-2">
							<ul className="list-disc space-y-1 pl-5 text-sm">
								{result.warnings.map((w) => {
									const plugin = pluginOf(w);
									return (
										<li key={`${w.section}:${w.message}`}>
											{w.message}{" "}
											{plugin && (
												<Link
													to="/$projectId/settings"
													params={{ projectId: result.id }}
													search={{ tab: "plugins", plugin }}
													className="text-accent underline"
												>
													Open the plugin
												</Link>
											)}
										</li>
									);
								})}
							</ul>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="primary" onPress={onOpen}>
								Open project
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
