import {
	Button,
	IntegrationSelector,
	Label,
	ListBox,
	Select,
	Spinner,
	Table,
} from "@fluxify/components";
import { useCallback, useState } from "react";
import { TbRestore } from "react-icons/tb";
import {
	EnterpriseChip,
	EnterpriseGate,
	useEnterpriseStorageBackups,
} from "@/components/common/Enterprise";
import { type RestoreSource, useRestoreFlow } from "@/components/home/restore/useRestoreFlow";
import { withBasePath } from "@/constants/routes";
import { formatDateTime } from "@/lib/datetime";
import { parseApiError } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import { type BackupScheduleView, backupsService, type RemoteBackup } from "@/services/backups";
import { integrationService } from "@/services/integrations";
import { useIsSystemAdmin } from "@/store/auth";
import { formatBytes } from "./format";
import { labelOf } from "./labels";

/** `Orders (restored 2026-11-16)`, cut to the 50 characters a project name allows */
export function restoredName(source: string, createdAt: string) {
	const end = ` (restored ${createdAt.slice(0, 10)})`;
	return source.slice(0, 50 - end.length).trimEnd() + end;
}

/** the archive of one listed backup as a restore source; a new project either way */
function remoteSource(
	projectId: string,
	integrationId: string,
	backup: RemoteBackup,
): RestoreSource {
	const target = { integrationId, key: backup.key };
	const own = backup.source.projectId === projectId;
	return {
		title: "New project from a backup",
		subtitle: backup.key,
		notice: own ? (
			<>
				This makes a <strong>new</strong> project from this project's backup; this one is left as it
				is. It keeps its subdomain, so the new project starts with none. To move it, clear the
				subdomain here, then set it on the new project in Project Settings.
			</>
		) : undefined,
		inspect: () => backupsService.inspectRemote(projectId, target),
		restore: (form) => backupsService.restoreRemote(projectId, target, form),
		prefill: (summary) => ({ name: restoredName(summary.source.name, backup.createdAt) }),
	};
}

function Rows({
	backups,
	canRestore,
	onRestore,
}: {
	backups: RemoteBackup[];
	canRestore: boolean;
	onRestore: (b: RemoteBackup) => void;
}) {
	return (
		<Table>
			<Table.ScrollContainer>
				<Table.Content aria-label="Backups in the bucket">
					<Table.Header>
						<Table.Column isRowHeader>Made</Table.Column>
						<Table.Column>Source project</Table.Column>
						<Table.Column>Release</Table.Column>
						<Table.Column>Size</Table.Column>
						<Table.Column>Resources</Table.Column>
						<Table.Column>{""}</Table.Column>
					</Table.Header>
					<Table.Body>
						{backups.map((b) => (
							<Table.Row key={b.key} id={b.key}>
								<Table.Cell>{formatDateTime(b.createdAt)}</Table.Cell>
								<Table.Cell>
									{b.source.name} <span className="text-muted">({b.source.slug})</span>
								</Table.Cell>
								<Table.Cell>{b.release}</Table.Cell>
								<Table.Cell>{formatBytes(b.sizeBytes)}</Table.Cell>
								<Table.Cell>
									<span className="text-muted">
										{Object.keys(b.sections).map(labelOf).join(", ")}
									</span>
								</Table.Cell>
								<Table.Cell>
									<Button
										size="sm"
										variant="secondary"
										isDisabled={!canRestore}
										onPress={() => onRestore(b)}
									>
										<TbRestore size={14} />
										Restore
									</Button>
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table.Content>
			</Table.ScrollContainer>
		</Table>
	);
}

/**
 * Project settings > Backup > Remote backups (#1107, Enterprise): the backups
 * in a bucket, read from their summaries, so this works on a fresh instance.
 * Any project's backups can be listed here (choose its prefix); restoring one
 * always makes a new project.
 */
export function RemoteBackups({
	projectId,
	view,
}: {
	projectId: string;
	view: BackupScheduleView;
}) {
	const licensed = useEnterpriseStorageBackups();
	const isAdmin = useIsSystemAdmin();
	const flow = useRestoreFlow();
	const loadIntegrations = useCallback(
		async () => (await integrationService.getAll(projectId, "storage")) ?? [],
		[projectId],
	);
	const [integrationId, setIntegrationId] = useState(view.schedule.integrationId);
	const [prefix, setPrefix] = useState(view.schedule.prefix || view.defaultPrefix);
	const prefixes = backupsQuery.remotePrefixes.useQuery(projectId, integrationId, licensed);
	const list = backupsQuery.remote.useQuery(projectId, integrationId, prefix, licensed);
	const choices = [...new Set([prefix, ...(prefixes.data ?? [])])].sort();
	const fromElsewhere = list.data?.some((b) => b.source.projectId !== projectId);
	const failure = list.error ?? prefixes.error;

	return (
		<section aria-label="Remote backups" className="flex flex-col gap-3">
			<div>
				<h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
					Remote backups <EnterpriseChip />
				</h2>
				<p className="text-sm text-muted">
					The backups in a bucket, this project's or another's, even from another instance that uses
					the same master key. Restoring one makes a new project.
				</p>
			</div>
			<EnterpriseGate
				unlocked={licensed}
				description="Restoring from object storage needs an Enterprise license."
			>
				<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<IntegrationSelector
							label="Integration"
							description="The Object Storage integration whose bucket holds the backups."
							group="storage"
							selectedId={integrationId ?? ""}
							loadIntegrations={loadIntegrations}
							onSelect={setIntegrationId}
							openInNewTabUrl={withBasePath(`/${projectId}/integrations?group=storage`)}
							createIntegrationUrl={withBasePath(`/${projectId}/integrations/new?group=storage`)}
						/>
						<Select
							fullWidth
							variant="secondary"
							aria-label="Prefix"
							value={prefix}
							onChange={(next) => setPrefix(String(next))}
						>
							<Label>Prefix</Label>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{choices.map((p) => (
										<ListBox.Item key={p} id={p} textValue={p}>
											<span className="font-mono text-xs">{p}</span>
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
					{fromElsewhere && (
						<p role="note" className="text-sm text-muted">
							Restoring creates a new project; you can delete this one afterwards.
						</p>
					)}
					{!isAdmin && (
						<p className="text-sm text-muted">
							Only a system admin can restore, because it creates a project.
						</p>
					)}
					{!integrationId ? (
						<p className="text-sm text-muted">Choose an integration to see its backups.</p>
					) : failure ? (
						<p role="alert" className="text-sm text-danger [overflow-wrap:anywhere]">
							{parseApiError(failure).message}
						</p>
					) : list.isLoading ? (
						<Spinner size="sm" />
					) : list.data?.length ? (
						<Rows
							backups={list.data}
							canRestore={isAdmin}
							onRestore={(b) => void flow.start(remoteSource(projectId, integrationId, b))}
						/>
					) : (
						<p className="text-sm text-muted">No complete backups under {prefix}/.</p>
					)}
				</div>
			</EnterpriseGate>
			{flow.element}
		</section>
	);
}
