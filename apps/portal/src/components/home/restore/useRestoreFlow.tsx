import { toast } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
	choiceReady,
	defaultChoice,
	RemovalList,
	RollbackForm,
	removals,
	withChoice,
} from "@/components/settings/backup/RollbackForm";
import { parseApiError } from "@/lib/errorNotifier";
import { projectsQuery } from "@/query/projectsQuery";
import type { RollbackChoice, RollbackResult, RollbackSummary } from "@/services/backups";
import type { ArchiveSummary, RestoreResult } from "@/services/projects";
import { EMPTY_FORM, formReady, NewProjectForm, type ProjectForm } from "./NewProjectForm";
import { RestoreDialog } from "./RestoreDialog";
import { RestoredWithWarnings } from "./RestoredWithWarnings";

type Common = { title?: string; subtitle: string; notice?: ReactNode };

/** where an archive comes from: an uploaded file (#1104) or a bucket (#1107); a new project either way */
export type NewProjectSource = Common & {
	kind?: "new";
	inspect: () => Promise<ArchiveSummary>;
	restore: (form: ProjectForm) => Promise<RestoreResult>;
	/** the form as it opens; the server's suggested name and slug otherwise */
	prefill?: (summary: ArchiveSummary) => Partial<ProjectForm>;
};

/** the same archives, rolled back into this project in place (#1130) */
export type RollbackSource = Common & {
	kind: "rollback";
	inspect: () => Promise<RollbackSummary>;
	restore: (choice: RollbackChoice) => Promise<RollbackResult>;
};

export type RestoreSource = NewProjectSource | RollbackSource;

type Pending = {
	source: RestoreSource;
	summary: ArchiveSummary | RollbackSummary | null;
	refusal?: string;
	form: ProjectForm;
	choice: RollbackChoice;
	error?: string;
	/** an exact replica that removes something, waiting for the user to confirm */
	confirming?: boolean;
};

const NO_CHOICE: RollbackChoice = { mode: "keep", sections: [], restoreSecrets: false };
const isRollback = (
	p: Pending,
): p is Pending & { source: RollbackSource; summary: RollbackSummary } =>
	p.source.kind === "rollback" && p.summary !== null;

/**
 * Inspect, confirm in `RestoreDialog`, then restore: into a new project, which
 * it opens or lists what to do first, or (a rollback source) into this one.
 * `start` opens the dialog; render `element`.
 */
export function useRestoreFlow() {
	const navigate = useNavigate();
	const client = useQueryClient();
	const [pending, setPending] = useState<Pending | null>(null);
	const [restoring, setRestoring] = useState(false);
	const [result, setResult] = useState<{ id?: string; warnings: RestoreResult["warnings"] } | null>(
		null,
	);

	const open = (id: string) => navigate({ to: "/$projectId", params: { projectId: id } });
	// a later pick replaces an earlier one still being checked
	const update = (source: RestoreSource, patch: (p: Pending) => Pending) =>
		setPending((p) => (p && p.source === source ? patch(p) : p));
	const edit = (patch: Partial<Pending>) =>
		setPending((p) => p && { ...p, ...patch, error: undefined });

	const start = async (source: RestoreSource) => {
		setPending({ source, summary: null, form: EMPTY_FORM, choice: NO_CHOICE });
		try {
			if (source.kind === "rollback") {
				const summary = await source.inspect();
				update(source, (p) => ({ ...p, summary, choice: defaultChoice(summary) }));
			} else {
				const summary = await source.inspect();
				const form = { ...EMPTY_FORM, ...summary.suggested, ...source.prefill?.(summary) };
				update(source, (p) => ({ ...p, summary, form }));
			}
		} catch (error) {
			const refusal = parseApiError(error).message;
			update(source, (p) => ({ ...p, refusal }));
		}
	};

	const run = async (p: Pending) => {
		setRestoring(true);
		try {
			if (isRollback(p)) {
				const done = await p.source.restore(p.choice);
				setPending(null);
				// the whole project may have changed under every open query
				await client.invalidateQueries();
				if (done.warnings.length > 0) setResult({ warnings: done.warnings });
				else toast.success("Rolled back. The backup taken first is in the history.");
			} else if (p.source.kind !== "rollback") {
				const done = await p.source.restore(p.form);
				setPending(null);
				projectsQuery.invalidateAll(client);
				if (done.warnings.length > 0) setResult(done);
				else open(done.id);
			}
		} catch (error) {
			const { message } = parseApiError(error);
			setPending((q) => q && { ...q, error: message, confirming: false });
		} finally {
			setRestoring(false);
		}
	};

	// an exact replica that removes something asks first, naming what goes
	const act = () => {
		if (!pending) return;
		if (
			isRollback(pending) &&
			removals(pending.summary, pending.choice).length &&
			!pending.confirming
		)
			edit({ confirming: true });
		else void run(pending);
	};

	const element = (
		<>
			{pending && (
				<RestoreDialog
					title={pending.source.title}
					subtitle={pending.source.subtitle}
					notice={pending.source.notice}
					summary={
						isRollback(pending) ? withChoice(pending.summary, pending.choice) : pending.summary
					}
					refusal={pending.refusal}
					{...(isRollback(pending)
						? {
								fields: (
									<RollbackForm
										summary={pending.summary}
										choice={pending.choice}
										onChoice={(choice) => edit({ choice })}
										isDisabled={restoring}
									/>
								),
								ready: choiceReady(pending.summary, pending.choice),
								action: "Roll back",
								note: "Rolls this project back in place, after backing it up.",
								busyNote: "Backing the project up, then rolling it back…",
							}
						: {
								fields: (
									<NewProjectForm
										form={pending.form}
										onForm={(form) => edit({ form })}
										isDisabled={restoring}
									/>
								),
								ready: formReady(pending.form),
								action: "Create project",
								note: "Restoring always makes a new project; nothing existing is changed.",
								busyNote:
									"Restoring… A template that fetches web knowledge sources can take a few minutes.",
							})}
					error={pending.error}
					isRestoring={restoring}
					onCreate={act}
					onClose={() => setPending(null)}
				/>
			)}
			{pending && isRollback(pending) && (
				<ConfirmDialog
					open={Boolean(pending.confirming)}
					onOpenChange={(isOpen) => !isOpen && edit({ confirming: false })}
					title="Remove what the backup doesn't have?"
					confirmText="Remove and roll back"
					danger
					pending={restoring}
					onConfirm={() => void run(pending)}
				>
					<RemovalList summary={pending.summary} choice={pending.choice} />
				</ConfirmDialog>
			)}
			{result && (
				<RestoredWithWarnings
					result={result}
					onOpen={result.id ? () => open(result.id!) : undefined}
					onClose={() => setResult(null)}
				/>
			)}
		</>
	);
	return { start, element };
}
