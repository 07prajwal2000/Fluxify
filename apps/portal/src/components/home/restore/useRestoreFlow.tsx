import { Button, CloseButton, Modal } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { parseApiError } from "@/lib/errorNotifier";
import { projectsQuery } from "@/query/projectsQuery";
import type { ArchiveSummary, RestoreResult } from "@/services/projects";
import { EMPTY_FORM, type ProjectForm } from "./NewProjectForm";
import { RestoreDialog } from "./RestoreDialog";

/** where an archive comes from: an uploaded file (#1104) or a bucket (#1107) */
export type RestoreSource = {
	title?: string;
	subtitle: string;
	notice?: ReactNode;
	inspect: () => Promise<ArchiveSummary>;
	restore: (form: ProjectForm) => Promise<RestoreResult>;
	/** the form as it opens; the server's suggested name and slug otherwise */
	prefill?: (summary: ArchiveSummary) => Partial<ProjectForm>;
};

type Pending = {
	source: RestoreSource;
	summary: ArchiveSummary | null;
	refusal?: string;
	form: ProjectForm;
	error?: string;
};

/**
 * Inspect, confirm in `RestoreDialog`, restore into a new project, then open it
 * or list what to do first. `start` opens the dialog; render `element`.
 */
export function useRestoreFlow() {
	const navigate = useNavigate();
	const client = useQueryClient();
	const [pending, setPending] = useState<Pending | null>(null);
	const [restoring, setRestoring] = useState(false);
	const [result, setResult] = useState<RestoreResult | null>(null);

	const open = (id: string) => navigate({ to: "/$projectId", params: { projectId: id } });
	// a later pick replaces an earlier one still being checked
	const update = (source: RestoreSource, patch: (p: Pending) => Pending) =>
		setPending((p) => (p && p.source === source ? patch(p) : p));

	const start = async (source: RestoreSource) => {
		setPending({ source, summary: null, form: EMPTY_FORM });
		try {
			const summary = await source.inspect();
			const form = { ...EMPTY_FORM, ...summary.suggested, ...source.prefill?.(summary) };
			update(source, (p) => ({ ...p, summary, form }));
		} catch (error) {
			const refusal = parseApiError(error).message;
			update(source, (p) => ({ ...p, refusal }));
		}
	};

	const create = async () => {
		if (!pending) return;
		setRestoring(true);
		try {
			const done = await pending.source.restore(pending.form);
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

	const element = (
		<>
			{pending && (
				<RestoreDialog
					title={pending.source.title}
					subtitle={pending.source.subtitle}
					notice={pending.source.notice}
					summary={pending.summary}
					refusal={pending.refusal}
					form={pending.form}
					onForm={(form) => setPending((p) => p && { ...p, form, error: undefined })}
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
	return { start, element };
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
