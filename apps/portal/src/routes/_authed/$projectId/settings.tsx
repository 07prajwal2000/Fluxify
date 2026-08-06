import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Button,
	Chip,
	IntegrationSelector,
	Modal,
	Spinner,
	Table,
	toast,
} from "@fluxify/components";
import { TbTrash } from "react-icons/tb";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { integrationService } from "@/services/integrations";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const ROLES = ["viewer", "creator", "project_admin"] as const;
type Role = (typeof ROLES)[number];

export const Route = createFileRoute("/_authed/$projectId/settings")({
	component: ProjectSettingsPage,
});

type Member = { id: string; userId: string; name: string; role: string };

function ProjectSettingsPage() {
	const { projectId } = Route.useParams();
	const [page, setPage] = useState(1);
	const { data, isLoading, isError } = projectMembersQuery.list.useQuery(projectId, {
		page,
		perPage: 20,
	});
	const remove = projectMembersQuery.remove.mutation(projectId);
	const [editing, setEditing] = useState<Member | null>(null);
	const [pendingRemove, setPendingRemove] = useState<Member | null>(null);

	const totalPages = data?.pagination?.totalPages ?? 1;

	return (
		<div className="flex max-w-4xl flex-col gap-4">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Project settings</h1>
				<p className="text-sm text-muted">Manage who can access this project.</p>
			</div>

			<TelemetryDestinations projectId={projectId} />

			<div>
				<h2 className="text-sm font-semibold tracking-tight">Members</h2>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load members.</p>
			) : (
				<Table>
					<Table.Content aria-label="Members">
						<Table.Header>
							<Table.Column id="name" isRowHeader>Member</Table.Column>
							<Table.Column id="role">Role</Table.Column>
							<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
						</Table.Header>
						<Table.Body items={(data?.data ?? []) as Member[]}>
							{(m: Member) => (
								<Table.Row id={m.userId}>
									<Table.Cell>{m.name}</Table.Cell>
									<Table.Cell>
										<Chip>{m.role.replace("_", " ")}</Chip>
									</Table.Cell>
									<Table.Cell>
										<div className="flex items-center justify-end gap-2">
											<Button variant="outline" onPress={() => setEditing(m)}>
												Change role
											</Button>
											<Button
												isIconOnly
												variant="ghost"
												aria-label="Remove member"
												onPress={() => setPendingRemove(m)}
											>
												<TbTrash size={16} />
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted">
					<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span>Page {page} of {totalPages}</span>
					<Button variant="outline" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
						Next
					</Button>
				</div>
			)}

			{editing && (
				<ChangeRoleDialog
					projectId={projectId}
					member={editing}
					onClose={() => setEditing(null)}
				/>
			)}

			<ConfirmDialog
				open={!!pendingRemove}
				onOpenChange={(o) => !o && setPendingRemove(null)}
				title="Remove member?"
				danger
				confirmText="Remove"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingRemove) return;
					remove.mutate(pendingRemove.userId, {
						onSuccess: () => toast.success("Member removed"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingRemove(null);
				}}
			>
				Remove <b className="text-foreground">{pendingRemove?.name}</b> from this project?
			</ConfirmDialog>
		</div>
	);
}

/**
 * One observability integration per signal. The picker is filtered by the
 * integration's tags, so an endpoint that cannot carry a signal never shows up
 * in that signal's list — Loki is logs-only, an OTLP endpoint carries all three.
 */
const TELEMETRY_SIGNALS = [
	{
		key: "settings.telemetry.logsConnectionId",
		tag: "logs",
		label: "Logs destination",
		description:
			"Where log blocks and the JavaScript logger api send records. Falls back to the server console when unset.",
	},
	{
		key: "settings.telemetry.tracesConnectionId",
		tag: "traces",
		label: "Traces destination",
		description:
			"Where request traces are exported. With none set, traced routes record no spans at all.",
	},
	{
		key: "settings.telemetry.metricsConnectionId",
		tag: "metrics",
		label: "Metrics destination",
		description: "Where route request counts and durations are exported.",
	},
] as const;

function TelemetryDestinations({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);

	const settings = (data ?? {}) as Record<string, string>;

	return (
		<div className="flex flex-col gap-1">
			<h2 className="text-sm font-semibold tracking-tight">Telemetry</h2>
			<p className="text-sm text-muted">
				Pick where this project's telemetry is exported.
			</p>
			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : (
				TELEMETRY_SIGNALS.map((signal) => (
					<TelemetrySelector
						key={signal.key}
						projectId={projectId}
						tag={signal.tag}
						label={signal.label}
						description={signal.description}
						// the legacy logs key is still read as a fallback server-side, so
						// an existing project shows its destination without a migration
						selectedId={
							settings[signal.key] ||
							(signal.tag === "logs"
								? settings["settings.ai.loggerConnectionId"] || ""
								: "")
						}
						onSelect={(value) =>
							upsert.mutate(
								{ key: signal.key, value } as RequestBodySchema,
								{
									onSuccess: () => toast.success("Destination saved"),
									onError: (e) => showErrorNotification(e as Error),
								},
							)
						}
					/>
				))
			)}
		</div>
	);
}

function TelemetrySelector({
	projectId,
	tag,
	label,
	description,
	selectedId,
	onSelect,
}: {
	projectId: string;
	tag: "logs" | "traces" | "metrics";
	label: string;
	description: string;
	selectedId: string;
	onSelect: (value: string) => void;
}) {
	const loadIntegrations = useCallback(
		async () =>
			(await integrationService.getAll(projectId, "observability", [tag])) ?? [],
		[projectId, tag],
	);

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group="observability"
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			onSelect={onSelect}
			onTestConnection={(id) =>
				integrationService
					.testExistingConnection(projectId, id, tag)
					.then(() => {})
			}
			openInNewTabUrl={withBasePath(
				`/${projectId}/integrations?group=observability${selectedId ? `&open=${encodeURIComponent(selectedId)}` : ""}`,
			)}
			createIntegrationUrl={withBasePath(
				`/${projectId}/integrations?group=observability`,
			)}
		/>
	);
}

function ChangeRoleDialog({
	projectId,
	member,
	onClose,
}: {
	projectId: string;
	member: Member;
	onClose: () => void;
}) {
	const update = projectMembersQuery.update.mutation(projectId);
	const initial = ROLES.includes(member.role as Role) ? (member.role as Role) : "viewer";
	const [role, setRole] = useState<Role>(initial);

	function save() {
		update.mutate(
			{ userId: member.userId, role },
			{
				onSuccess: () => {
					toast.success("Role updated");
					onClose();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<Modal isOpen onOpenChange={(o) => !o && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Change role</Modal.Heading>
							<p className="mt-1 text-sm text-muted">{member.name}</p>
						</Modal.Header>
						<Modal.Body>
							<div className="flex gap-1.5">
								{ROLES.map((r) => (
									<Button
										key={r}
										type="button"
										variant={role === r ? "primary" : "outline"}
										onPress={() => setRole(r)}
									>
										{r.replace("_", " ")}
									</Button>
								))}
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={onClose}>
								Cancel
							</Button>
							<Button variant="primary" isPending={update.isPending} onPress={save}>
								Save
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
