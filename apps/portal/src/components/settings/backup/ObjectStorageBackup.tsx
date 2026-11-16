import {
	Button,
	Checkbox,
	Description,
	Input,
	IntegrationSelector,
	Label,
	ListBox,
	NumberField,
	Select,
	TextField,
	toast,
} from "@fluxify/components";
import { useCallback, useState } from "react";
import { TbCloudUpload } from "react-icons/tb";
import {
	EnterpriseChip,
	EnterpriseGate,
	useEnterpriseStorageBackups,
} from "@/components/common/Enterprise";
import { withBasePath } from "@/constants/routes";
import { getTimeAgo } from "@/lib/datetime";
import { showErrorNotification } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import type { BackupInterval, BackupScheduleView } from "@/services/backups";
import { integrationService } from "@/services/integrations";

const INTERVALS: Record<BackupInterval, string> = {
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
};

/** the prefix rule the server checks, so the field can say so before saving */
const PREFIX = /^[A-Za-z0-9][\w.-]*(\/[A-Za-z0-9][\w.-]*)*$/;

/** what the resource picker above holds; a scheduled backup takes the same */
export type BackupSelection = {
	sections: string[];
	includeVersionHistory: boolean;
	includeAppConfigValues: boolean;
};

function LastRun({ view }: { view: BackupScheduleView }) {
	const run = view.lastRun;
	if (!run) return <p className="text-sm text-muted">No backup to object storage yet.</p>;
	if (run.status === "running") return <p className="text-sm text-muted">A backup is uploading…</p>;
	if (run.status === "failed")
		return (
			<p role="alert" className="text-sm text-danger [overflow-wrap:anywhere]">
				The last backup failed {getTimeAgo(run.createdAt)}: {run.error}
			</p>
		);
	return (
		<p className="text-sm text-muted [overflow-wrap:anywhere]">
			Last backup {getTimeAgo(run.createdAt)}:{" "}
			<span className="font-mono text-xs">{run.destinationKey}</span>
		</p>
	);
}

/**
 * Project settings > Backup > Object storage (#1106, Enterprise): upload a
 * backup to an Object Storage integration on a schedule, or now. It always
 * makes an encrypted backup of the resources ticked above. Without the license
 * the settings stay visible, locked, and nothing runs.
 */
export function ObjectStorageBackup({
	projectId,
	view,
	selection,
}: {
	projectId: string;
	view: BackupScheduleView;
	selection: BackupSelection;
}) {
	const licensed = useEnterpriseStorageBackups();
	const loadIntegrations = useCallback(
		async () => (await integrationService.getAll(projectId, "storage")) ?? [],
		[projectId],
	);
	const save = backupsQuery.saveSchedule.useMutation(projectId);
	const now = backupsQuery.backupNow.useMutation(projectId);
	const saved = view.schedule;

	const [integrationId, setIntegrationId] = useState(saved.integrationId);
	const [prefix, setPrefix] = useState(saved.prefix || view.defaultPrefix);
	const [interval, setInterval] = useState(saved.interval);
	const [retention, setRetention] = useState(saved.retention);
	const [enabled, setEnabled] = useState(saved.enabled);

	const badPrefix = !PREFIX.test(prefix);
	const running = view.lastRun?.status === "running";
	const canSave = Boolean(integrationId) && !badPrefix && selection.sections.length > 0;

	const submit = () =>
		save.mutate(
			{ integrationId: integrationId!, prefix, interval, retention, enabled, ...selection },
			{
				onSuccess: () => toast.success("Object storage settings saved."),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	const upload = () =>
		now.mutate(undefined, {
			onSuccess: () => toast.success("Backup started."),
			onError: (e) => showErrorNotification(e as Error),
		});

	return (
		<section aria-label="Object storage" className="flex flex-col gap-3">
			<div>
				<h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
					Object storage <EnterpriseChip />
				</h2>
				<p className="text-sm text-muted">
					Upload an encrypted backup of the resources ticked above to a bucket, on a schedule or
					now. The oldest ones beyond the number kept are deleted after each new backup.
				</p>
			</div>
			<EnterpriseGate
				unlocked={licensed}
				description="Backups to object storage need an Enterprise license. The settings and history are kept, and nothing runs."
			>
				<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
					{saved.integrationId && !saved.prefix && (
						<p role="note" className="text-sm text-warning">
							Scheduled backups are off. Choose a prefix no other project uses, then turn them on.
						</p>
					)}
					<IntegrationSelector
						label="Integration"
						description="The Object Storage integration whose bucket the backups go to."
						group="storage"
						selectedId={integrationId ?? ""}
						loadIntegrations={loadIntegrations}
						onSelect={setIntegrationId}
						onTestConnection={(id) =>
							integrationService.testExistingConnection(projectId, id).then(() => {})
						}
						openInNewTabUrl={withBasePath(
							`/${projectId}/integrations${integrationId ? `/${encodeURIComponent(integrationId)}` : "?group=storage"}`,
						)}
						createIntegrationUrl={withBasePath(`/${projectId}/integrations/new?group=storage`)}
					/>
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField value={prefix} onChange={setPrefix} isInvalid={badPrefix}>
							<Label>Prefix</Label>
							<Input className="font-mono text-xs" />
							<Description>
								{badPrefix
									? "Letters, digits, '.', '_' and '-', in parts separated by '/', with no '/' at either end."
									: `Backups go to ${prefix}/<time>-<id>.tar.gz. Use one no other project uses.`}
							</Description>
						</TextField>
						<Select
							fullWidth
							variant="secondary"
							value={interval}
							onChange={(next) => setInterval(next as BackupInterval)}
						>
							<Label>How often</Label>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{(Object.keys(INTERVALS) as BackupInterval[]).map((k) => (
										<ListBox.Item key={k} id={k} textValue={INTERVALS[k]}>
											{INTERVALS[k]}
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
						<NumberField
							value={retention}
							minValue={1}
							maxValue={1000}
							step={1}
							onChange={setRetention}
						>
							<Label>Backups to keep</Label>
							<NumberField.Group>
								<NumberField.DecrementButton />
								<NumberField.Input />
								<NumberField.IncrementButton />
							</NumberField.Group>
						</NumberField>
					</div>
					<Checkbox
						isSelected={enabled}
						onChange={(on: boolean) => setEnabled(on)}
						label="Back up on a schedule"
						description="Checked once a day; a backup runs when the interval has passed since the last one that succeeded."
					/>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							variant="primary"
							onPress={submit}
							isDisabled={!canSave}
							isPending={save.isPending}
						>
							Save
						</Button>
						<Button
							variant="secondary"
							onPress={upload}
							isDisabled={!saved.integrationId || !saved.prefix || running}
							isPending={now.isPending}
						>
							<TbCloudUpload size={16} />
							Back up now
						</Button>
					</div>
					<LastRun view={view} />
				</div>
			</EnterpriseGate>
		</section>
	);
}
