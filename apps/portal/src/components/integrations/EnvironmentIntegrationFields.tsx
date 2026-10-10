import { Checkbox, Label } from "@fluxify/components";
import { TbAlertTriangle } from "react-icons/tb";
import { ConnectorFields } from "./ConnectorFields";

export type EnvironmentIntegrationFieldsProps = {
	projectId: string;
	group: string;
	variant: string;
	name: string;
	onName: (v: string) => void;
	config: Record<string, unknown>;
	setField: (path: string, value: unknown) => void;
	devConfig: Record<string, unknown> | null;
	setDevField: (path: string, value: unknown) => void;
	syncDev: boolean;
	onSyncDevChange: (sync: boolean) => void;
};

export function isConfigEmpty(config: Record<string, unknown> | null | undefined): boolean {
	if (!config) return true;
	const meaningfulEntries = Object.entries(config).filter(([k]) => k !== "source");
	if (meaningfulEntries.length === 0) return true;
	return meaningfulEntries.every(([, v]) => v === "" || v === null || v === undefined);
}

export function EnvironmentIntegrationFields({
	projectId,
	group,
	variant,
	name,
	onName,
	config,
	setField,
	devConfig,
	setDevField,
	syncDev,
	onSyncDevChange,
}: EnvironmentIntegrationFieldsProps) {
	const devEmpty = isConfigEmpty(devConfig);

	return (
		<div className="flex flex-col gap-6">
			{/* Production Section */}
			<div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
				<div className="flex items-center justify-between border-b border-border pb-2">
					<div>
						<h3 className="text-sm font-semibold text-foreground">Production</h3>
						<p className="text-xs text-muted">Configuration for production runs and workers.</p>
					</div>
					<span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted">
						Production
					</span>
				</div>
				<ConnectorFields
					projectId={projectId}
					group={group}
					variant={variant}
					name={name}
					onName={onName}
					config={config}
					setField={setField}
				/>
			</div>

			{/* Toggle & Warning / Development Section */}
			<div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
				<div className="flex items-center justify-between">
					<Checkbox isSelected={syncDev} onChange={onSyncDevChange} aria-label="Same as production">
						<Checkbox.Content>
							<Checkbox.Control>
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Label className="text-sm font-medium text-foreground cursor-pointer">
								Same as production
							</Label>
						</Checkbox.Content>
					</Checkbox>
				</div>

				{syncDev ? (
					<div
						role="alert"
						className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger"
					>
						<div className="flex items-start gap-3">
							<TbAlertTriangle size={20} className="shrink-0 mt-0.5 text-danger" />
							<div className="text-sm">
								<p className="font-semibold text-danger">Same as production</p>
								<p className="mt-1 text-xs text-danger/90">
									Dev runs, dev triggers and AI agents will read and write production — same
									database, same queues, same consumer groups. Use separate dev instances instead.
								</p>
							</div>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-4 pt-1">
						<div className="flex items-center justify-between border-b border-border pb-2">
							<div>
								<h3 className="text-sm font-semibold text-foreground">Development</h3>
								<p className="text-xs text-muted">Configuration for local and development runs.</p>
							</div>
							<span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted">
								Development
							</span>
						</div>
						{devEmpty && (
							<p className="text-xs text-warning">
								Dev workers will fail until you set a development value or turn on Same as
								production.
							</p>
						)}
						<ConnectorFields
							projectId={projectId}
							group={group}
							variant={variant}
							name={name}
							onName={onName}
							config={devConfig ?? {}}
							setField={setDevField}
							hideName
						/>
					</div>
				)}
			</div>
		</div>
	);
}
