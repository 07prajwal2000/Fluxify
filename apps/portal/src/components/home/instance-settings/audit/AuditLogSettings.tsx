import { Button, Spinner } from "@fluxify/components";
import { type ReactNode, useState } from "react";
import { TbHistory } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { EnterpriseGate, hasAuditLogs } from "@/components/common/Enterprise";
import { auditLogsQuery } from "@/query/auditLogsQuery";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import type { AuditFilters, AuditRow } from "@/services/auditLogs";
import { AuditEventsTable } from "./AuditEventsTable";
import { AuditFilterBar } from "./AuditFilterBar";
import { AuditRowDetail } from "./AuditRowDetail";

function Heading() {
	return (
		<div>
			<h2 className="text-xl font-bold tracking-tight">Audit logs</h2>
			<p className="mt-0.5 text-sm text-muted-foreground">
				Who changed what, and how they got in. Only the names of changed settings are kept, never
				their values.
			</p>
		</div>
	);
}

/** Instance settings > Audit logs. Locked, and nothing is requested, without the licence feature. */
export function AuditLogSettings({
	project,
	onProjectChange,
}: {
	/** from the page's `?project=`, so a link or refresh keeps the filter */
	project?: string;
	onProjectChange: (project: string | undefined) => void;
}) {
	// not "assumed licensed" while loading, as the nav is: that would request the log first
	const { data: settings } = publicSettingsQuery.get.useQuery();
	if (!settings) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (!hasAuditLogs(settings.license)) {
		return (
			<div className="flex flex-col gap-6">
				<Heading />
				<EnterpriseGate
					unlocked={false}
					title="Enterprise only"
					description="Audit logs need an Enterprise license that includes them."
				>
					<div className="h-64 rounded-xl border border-border bg-background" />
				</EnterpriseGate>
			</div>
		);
	}
	return <AuditLogView project={project} onProjectChange={onProjectChange} />;
}

function AuditLogView({
	project,
	onProjectChange,
}: {
	project?: string;
	onProjectChange: (project: string | undefined) => void;
}) {
	// everything but the project stays in this page; the project lives in the URL
	const [others, setOthers] = useState<AuditFilters>({});
	const [open, setOpen] = useState<AuditRow | null>(null);
	const filters: AuditFilters = { ...others, projectId: project };

	const options = auditLogsQuery.filters.useQuery();
	const list = auditLogsQuery.list.useInfiniteQuery(filters);
	const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
	const filtered = Object.values(filters).some(Boolean);

	function change(patch: Partial<AuditFilters>) {
		const { projectId, ...rest } = patch;
		if ("projectId" in patch) onProjectChange(projectId);
		setOthers((prev) => ({ ...prev, ...rest }));
	}

	let body: ReactNode;
	if (list.isLoading) {
		body = (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	} else if (list.isError) {
		body = (
			<div className="flex flex-col items-center gap-3 py-16">
				<p className="text-sm text-muted">Couldn't load the audit logs.</p>
				<Button variant="outline" onPress={() => list.refetch()}>
					Try again
				</Button>
			</div>
		);
	} else if (!rows.length) {
		body = (
			<EmptyState
				icon={<TbHistory size={24} />}
				title={filtered ? "No events match these filters" : "No events yet"}
				description={
					filtered
						? "Try a wider time range, or clear a filter."
						: "Events appear here once audit logs are turned on for a project, in its settings."
				}
			/>
		);
	} else {
		body = (
			<>
				<AuditEventsTable rows={rows} onOpen={setOpen} />
				{list.hasNextPage && (
					<div className="flex justify-center">
						<Button
							variant="outline"
							isPending={list.isFetchingNextPage}
							onPress={() => list.fetchNextPage()}
						>
							Load more
						</Button>
					</div>
				)}
			</>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<Heading />
			<AuditFilterBar
				filters={filters}
				options={options.data}
				onChange={change}
				onClear={() => {
					setOthers({});
					onProjectChange(undefined);
				}}
			/>
			<div className="flex flex-col gap-4">{body}</div>
			<AuditRowDetail row={open} onClose={() => setOpen(null)} />
		</div>
	);
}
