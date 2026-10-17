import { Checkbox, Spinner, toast } from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { Link } from "@tanstack/react-router";
import { useEnterpriseAuditLogs } from "@/components/common/Enterprise";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { useIsProjectAdmin, useIsSystemAdmin } from "@/store/auth";

const KEY = "auditLogs.enabled";

/** Project settings > Audit logs: the switch, and the way to the page that shows the log. */
export function ProjectAuditSettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const licensed = useEnterpriseAuditLogs();
	const isProjectAdmin = useIsProjectAdmin(projectId);
	const isSystemAdmin = useIsSystemAdmin();

	// no saved value means off
	const enabled = (data as Record<string, string> | undefined)?.[KEY] === "true";
	const canChange = licensed && isProjectAdmin;

	const save = (on: boolean) =>
		upsert.mutate({ key: KEY, value: on ? "true" : "false" } as RequestBodySchema, {
			onSuccess: () => toast.success(`Audit logs turned ${on ? "on" : "off"}`),
			onError: (e) => showErrorNotification(e as Error),
		});

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Audit logs</h1>
				<p className="text-sm text-muted">
					Keep a record of who changes this project, and how they got in.
				</p>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : (
				<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
					<Checkbox
						isSelected={enabled}
						isDisabled={!canChange}
						onChange={(on: boolean) => save(on)}
						label="Record audit logs for this project"
						description="Turning it off stops new entries. The ones already recorded stay until they age out."
					/>
					{!licensed && (
						<p role="note" className="text-sm text-muted">
							Audit logs need an Enterprise license that includes them.
						</p>
					)}
					{licensed && !isProjectAdmin && (
						<p role="note" className="text-sm text-muted">
							Only a project admin can change this.
						</p>
					)}
				</div>
			)}

			{licensed && isSystemAdmin && (
				<Link
					to="/"
					search={{ tab: "instance", settingsTab: "audit", project: projectId }}
					className="w-fit text-sm text-accent hover:underline"
				>
					View this project's audit logs
				</Link>
			)}
		</div>
	);
}
