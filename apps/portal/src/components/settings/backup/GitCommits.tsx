import { Button, Spinner, Table } from "@fluxify/components";
import { TbRestore } from "react-icons/tb";
import { type RestoreSource, useRestoreFlow } from "@/components/home/restore/useRestoreFlow";
import { formatDateTime } from "@/lib/datetime";
import { parseApiError } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import { backupsService, type GitCommit } from "@/services/backups";
import { useIsSystemAdmin } from "@/store/auth";
import { restoredName } from "./RemoteBackups";

/** one commit as a restore source: always a new project */
function gitSource(projectId: string, commit: GitCommit): RestoreSource {
	return {
		title: "New project from a git commit",
		subtitle: `${commit.sha.slice(0, 10)} ${commit.message.split("\n")[0]}`,
		inspect: () => backupsService.inspectGit(projectId, commit.sha),
		restore: (form) => backupsService.restoreGit(projectId, commit.sha, form),
		prefill: (summary) => ({ name: restoredName(summary.source.name, commit.date) }),
	};
}

/** the branch's newest commits; Restore makes a new project from one (system admins only) */
export function GitCommits({ projectId, revision }: { projectId: string; revision: string }) {
	const isAdmin = useIsSystemAdmin();
	const flow = useRestoreFlow();
	const list = backupsQuery.gitCommits.useQuery(projectId, revision);

	return (
		<section aria-label="Git commits" className="flex flex-col gap-3">
			<div>
				<h3 className="text-sm font-semibold text-foreground">Restore from git</h3>
				<p className="text-sm text-muted">
					The newest commits on the branch. Restore makes a new project from one; this project is
					left as it is.
				</p>
			</div>
			{!isAdmin && (
				<p className="text-sm text-muted">
					Only a system admin can restore, because it creates a project.
				</p>
			)}
			{list.error ? (
				<p role="alert" className="text-sm text-danger [overflow-wrap:anywhere]">
					{parseApiError(list.error).message}
				</p>
			) : list.isLoading ? (
				<Spinner size="sm" />
			) : list.data?.length ? (
				<Table>
					<Table.ScrollContainer>
						<Table.Content aria-label="Commits on the branch">
							<Table.Header>
								<Table.Column isRowHeader>Message</Table.Column>
								<Table.Column>Commit</Table.Column>
								<Table.Column>Author</Table.Column>
								<Table.Column>When</Table.Column>
								<Table.Column>{""}</Table.Column>
							</Table.Header>
							<Table.Body>
								{list.data.map((c) => (
									<Table.Row key={c.sha} id={c.sha}>
										<Table.Cell className="max-w-[18rem]">
											<span className="block truncate" title={c.message}>
												{c.message.split("\n")[0]}
											</span>
										</Table.Cell>
										<Table.Cell>
											<span className="font-mono text-xs">{c.sha.slice(0, 10)}</span>
										</Table.Cell>
										<Table.Cell>{c.author}</Table.Cell>
										<Table.Cell>{formatDateTime(c.date)}</Table.Cell>
										<Table.Cell>
											<div className="flex justify-end">
												<Button
													size="sm"
													variant="secondary"
													isDisabled={!isAdmin}
													aria-label={`Restore ${c.sha.slice(0, 10)}`}
													onPress={() => void flow.start(gitSource(projectId, c))}
												>
													<TbRestore size={14} />
													Restore
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
			) : (
				<p className="text-sm text-muted">No commits on the branch yet.</p>
			)}
			{flow.element}
		</section>
	);
}
